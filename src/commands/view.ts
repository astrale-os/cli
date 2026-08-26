import type { ResolvedView } from '@astrale-os/shell'

import chalk from 'chalk'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { KernelCommandOpts } from '../connection'
import type { ViewServeConfig, ViewSessionRecord } from '../lib/view/session'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, withClientSession } from '../connection'
import { AstraleError } from '../errors'
import { readIdentities } from '../identity/index'
import { ab, AGENT_BROWSER_REPO, BROWSER_DIR, findAgentBrowser } from '../lib/browser'
import { readInstances } from '../lib/instance'
import { fatal, log } from '../lib/log'
import { isMachine, output, type RawOutputOpts } from '../lib/output'
import { findFreePort } from '../lib/port'
import { run, spawnHandle } from '../lib/proc'
import { admitExternalOpenOrigins } from '../lib/view/external-open-origins'
import { withViewPortAllocationLock } from '../lib/view/port-allocation'
import {
  candidateSlug,
  parseViewSpec,
  pickCandidate,
  resolveViewCandidates,
  selectedView,
  type ViewCandidate,
  viewOwnerTarget,
} from '../lib/view/resolve'
import { ensureViewerAssets } from '../lib/view/server'
import {
  closeSession,
  configPath,
  listSessions,
  logPath,
  openSessionLog,
  saveRecord,
  saveServeConfig,
} from '../lib/view/session'
import { snapshotText, waitForSettledSnapshot } from '../lib/view/snapshot'

/**
 * `astrale view` — open ONE view in a local browser shell, authenticated as
 * the CLI identity, driveable by agent-browser (default) or a real browser.
 * Design + protocol details: VIEW_CLI_SPEC.md at the workspace root.
 */

type ViewOpts = KernelCommandOpts &
  RawOutputOpts & {
    target?: string
    view?: string
    list?: boolean
    viewUrl?: string
    handshake?: 'shell' | 'none'
    headed?: boolean
    browser?: boolean
    open?: boolean
    snapshot?: boolean
    screenshot?: string
    sessions?: boolean
    close?: string | boolean
    all?: boolean
    allowExternalOrigin?: string[]
  }

const VIEW_PORT_BASE = 4419
const VIEW_PORT_SPAN = 20
const IDLE_MS = 30 * 60_000
const READY_TIMEOUT_MS = 8000
const STATE_TIMEOUT_MS = 25_000
const POLL_MS = 250
/** Dedicated agent-browser profile for view sessions (no cookies involved). */
const VIEW_PROFILE = `${BROWSER_DIR}/_view`

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function resolveSession(
  spec: string,
  opts: ViewOpts,
): Promise<{ view?: ResolvedView; candidates: ViewCandidate[] }> {
  rejectUnrepresentableOverrides(opts)
  const parsed = parseViewSpec(spec)
  if (parsed.kind === 'target' && opts.target) {
    fatal(new Error('Pass the target either as the positional or as --target, not both'))
  }
  if (parsed.kind === 'view' && opts.view) {
    fatal(new Error('An explicit ViewPath cannot be combined with --view <slug>'))
  }
  const targetInput =
    parsed.kind === 'target' ? parsed.path : (opts.target ?? viewOwnerTarget(parsed.path))
  const { target, candidates } = await withClientSession(opts, async (context) => {
    const { path: target } = await expandSelfInPath(targetInput, context)
    return { target, candidates: await resolveViewCandidates(context, target) }
  })

  if (opts.list) {
    return { candidates }
  }
  const selector = parsed.kind === 'view' ? parsed.path : opts.view
  const picked = await chooseCandidate(candidates, target, selector, opts)
  return {
    view: selectedView(picked),
    candidates,
  }
}

/**
 * Retain the frozen command flags while failing closed: neither legacy flag
 * has a truthful representation in V2's verified View placement contract.
 */
export function rejectUnrepresentableOverrides(
  opts: Pick<ViewOpts, 'handshake' | 'viewUrl'>,
): void {
  if (opts.viewUrl === undefined && opts.handshake === undefined) return
  throw new AstraleError(
    'UNSUPPORTED_VIEW_OVERRIDE',
    '--view-url and --handshake cannot override a V2 View: the Shell mounts one verified View placement with complete provenance.',
    'Pass a ViewPath or target and use the placement published by its Domain.',
  )
}

async function chooseCandidate(
  candidates: ViewCandidate[],
  anchor: string,
  selector: string | undefined,
  opts: ViewOpts,
): Promise<ViewCandidate> {
  const picked = pickCandidate(candidates, anchor, selector)
  if (picked !== 'ambiguous') return picked
  if (process.stdin.isTTY && !isMachine(opts)) {
    const { select } = await import('@inquirer/prompts')
    return select({
      message: `${anchor} has ${candidates.length} views — open which?`,
      choices: candidates.map((c) => ({
        name: `${candidateSlug(c)}  ${chalk.dim(c.url)}`,
        value: c,
      })),
    })
  }
  throw new AstraleError(
    'AMBIGUOUS_VIEW',
    `${anchor} resolves ${candidates.length} views — pick one with --view <slug>: ${candidates.map(candidateSlug).join(', ')}`,
  )
}

/**
 * The session server must run under NODE when possible: an orphaned Bun
 * process on macOS cannot open TLS sockets at all (its TLS init needs the
 * user session's trust services), so token mints and the kernel proxy would
 * die once the CLI exits. The published CLI entry is node-runnable; a dev
 * checkout builds `dist/astrale.js` on demand (Bun is present there).
 */
interface ServeRuntimeEnvironment {
  readonly entry: string | undefined
  readonly executable: string
  readonly exists: typeof existsSync
  readonly find: typeof findOnPath
}

export async function resolveServeRuntime(
  environment: Partial<ServeRuntimeEnvironment> = {},
): Promise<{ file: string; args: string[] }> {
  const entry = environment.entry ?? process.argv[1]
  const executable = environment.executable ?? process.execPath
  const exists = environment.exists ?? existsSync
  const find = environment.find ?? findOnPath
  const node = await find('node')
  if (node && entry?.endsWith('.js') && exists(entry)) return { file: node, args: [entry] }
  if (node && entry?.endsWith('.ts')) {
    const dist = join(dirname(entry), '..', 'dist', 'astrale.js')
    await ensureDevDist(entry, dist)
    if (exists(dist)) return { file: node, args: [dist] }
  }
  return directServeRuntime(executable, entry, entry !== undefined && exists(entry))
}

/** Reinvoke a compiled executable without its virtual Bun filesystem entry. */
export function directServeRuntime(
  executable: string,
  entry: string | undefined,
  entryExists = entry !== undefined && existsSync(entry),
): { file: string; args: string[] } {
  return {
    file: executable,
    args: entry && !entry.startsWith('/$bunfs/') && entryExists ? [entry] : [],
  }
}

export function viewServeInvocation(
  runtime: { file: string; args: string[] },
  config: string,
): { file: string; args: string[] } {
  return { file: runtime.file, args: [...runtime.args, '__view-serve', '--config', config] }
}

async function findOnPath(name: string): Promise<string | null> {
  const lookup =
    process.platform === 'win32' ? run('where', [name]) : run('sh', ['-c', `command -v ${name}`])
  const res = await lookup.catch(() => null)
  if (!res || res.code !== 0) return null
  return res.stdout.split(/\r?\n/)[0]?.trim() || null
}

/** Dev checkout: (re)build the node-runnable CLI bundle when missing or stale. */
async function ensureDevDist(entry: string, dist: string): Promise<void> {
  if (!(await devDistIsStale(entry, dist))) return
  const projectDir = join(dirname(entry), '..')
  const buildScript = join(projectDir, 'scripts', 'build.ts')
  const bun = await findOnPath('bun')
  if (!bun || !existsSync(buildScript)) return

  // Build output goes to stderr so --json stdout remains valid.
  console.error('(dev) dist/astrale.js is stale — running the official CLI build…')
  const built = await run(bun, [buildScript], { cwd: projectDir })
  if (built.stdout) process.stderr.write(built.stdout)
  if (built.stderr) process.stderr.write(built.stderr)
  if (built.code !== 0) throw new Error(`Official CLI build failed with exit code ${built.code}.`)
}

export async function devDistIsStale(entry: string, dist: string): Promise<boolean> {
  if (!existsSync(dist)) return true
  const projectDir = join(dirname(entry), '..')
  const builtAt = statSync(dist).mtimeMs
  const directories = [join(projectDir, 'src'), join(projectDir, 'bin'), join(projectDir, 'vendor')]
  const files = [
    join(projectDir, 'scripts', 'build.ts'),
    join(projectDir, 'package.json'),
    join(projectDir, 'pnpm-lock.yaml'),
  ]
  for (const directory of directories) {
    if (existsSync(directory) && (await newerThan(directory, builtAt))) return true
  }
  return files.some((file) => existsSync(file) && statSync(file).mtimeMs > builtAt)
}

async function newerThan(dir: string, mtimeMs: number): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  for (const item of entries) {
    if (!item.isFile()) continue
    if (statSync(join(item.parentPath, item.name)).mtimeMs > mtimeMs) return true
  }
  return false
}

/** Spawn the detached session server (the CLI re-invoking itself) and wait for it. */
async function startSession(view: ResolvedView, opts: ViewOpts): Promise<ViewSessionRecord> {
  await ensureViewerAssets()
  const kernelTarget = await withClientSession(
    opts,
    async ({ target: connectionTarget }) => connectionTarget,
  )
  const [instances, identities, runtime] = await Promise.all([
    readInstances(),
    readIdentities(),
    resolveServeRuntime(),
  ])
  return withViewPortAllocationLock(() =>
    startSessionLocked(view, opts, kernelTarget, instances.active, identities.default, runtime),
  )
}

export function createViewServeConfig(
  record: ViewSessionRecord,
  opts: Pick<ViewOpts, 'allowExternalOrigin' | 'as' | 'creds' | 'instance' | 'timeout' | 'url'>,
  kernelTarget: { url: string; kernelIssuer: string; caFile?: string },
): ViewServeConfig {
  return {
    session: record,
    kernel: {
      url: opts.url,
      instance: opts.instance,
      as: opts.as,
      creds: opts.creds,
      timeout: opts.timeout,
    },
    proxy: {
      kernelUrl: kernelTarget.url,
      issuer: kernelTarget.kernelIssuer,
      caFile: kernelTarget.caFile,
      direct: isPublicHttps(kernelTarget.url) && !kernelTarget.caFile,
    },
    externalOrigins: admitExternalOpenOrigins(opts.allowExternalOrigin),
    idleMs: IDLE_MS,
  }
}

/**
 * Called under the cross-process port-allocation lock. Keep the lock until the
 * detached child answers its readiness probe: only then is the selected port
 * durably owned and safe for the next CLI process to scan.
 */
async function startSessionLocked(
  view: ResolvedView,
  opts: ViewOpts,
  kernelTarget: { url: string; kernelIssuer: string; caFile?: string },
  activeInstance: string | undefined,
  defaultIdentity: string | undefined,
  runtime: { file: string; args: string[] },
): Promise<ViewSessionRecord> {
  const port = await findFreePort(VIEW_PORT_BASE, VIEW_PORT_SPAN)
  if (port === null) {
    throw new Error(
      `No free port in ${VIEW_PORT_BASE}-${VIEW_PORT_BASE + VIEW_PORT_SPAN - 1} — close sessions with \`astrale view --close --all\``,
    )
  }

  const id = `v-${randomBytes(3).toString('hex')}`
  const nonce = randomBytes(12).toString('hex')
  const record: ViewSessionRecord = {
    id,
    pid: 0,
    port,
    nonce,
    pageUrl: `http://127.0.0.1:${port}/s/${nonce}/`,
    view,
    instance: opts.instance ?? (opts.url ? opts.url : activeInstance),
    identity: opts.creds ? '(pre-signed creds)' : (opts.as ?? defaultIdentity),
    createdAt: new Date().toISOString(),
  }
  const serveConfig = createViewServeConfig(record, opts, kernelTarget)

  await saveServeConfig(serveConfig)
  const logFd = await openSessionLog(id)
  const invocation = viewServeInvocation(runtime, configPath(id))
  const child = spawnHandle(invocation.file, invocation.args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  child.unref()
  closeSync(logFd)
  if (!child.pid) throw new Error('Failed to spawn the view session server')
  const live = { ...record, pid: child.pid }
  await saveRecord(live)

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${live.pageUrl}state`)
      if (res.ok) return live
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) break
    await sleep(POLL_MS)
  }
  const tail = await readFile(logPath(id), 'utf8').catch(() => '')
  await closeSession(live)
  throw new Error(
    `View session server did not come up.${tail ? `\n--- server log ---\n${tail.slice(-2000)}` : ''}`,
  )
}

type PageState = { state: string; error?: string }

async function waitForPageState(record: ViewSessionRecord): Promise<PageState> {
  const deadline = Date.now() + STATE_TIMEOUT_MS
  let last: PageState = { state: 'waiting' }
  while (Date.now() < deadline) {
    try {
      last = (await (await fetch(`${record.pageUrl}state`)).json()) as PageState
      if (last.state === 'connected' || last.state === 'plain' || last.state === 'failed') {
        return last
      }
    } catch {
      // transient
    }
    await sleep(POLL_MS)
  }
  return last
}

/**
 * Public https kernels are dialed directly by the view iframe (the router
 * serves CORS; Chrome's local-network-access rules forbid a public view
 * origin fetching our loopback proxy). Local/self-signed kernels go through
 * the proxy.
 */
function isPublicHttps(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      !['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(parsed.hostname)
    )
  } catch {
    return false
  }
}

function openSystemBrowser(url: string): void {
  const argv =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  void run(argv[0], argv.slice(1)).catch(() => {})
}

function driveHint(headed: boolean): string {
  return `agent-browser --profile ${VIEW_PROFILE}${headed ? ' --headed' : ''}`
}

function describeState(state: PageState): string {
  switch (state.state) {
    case 'connected':
      return 'connected (shell handshake, kernel calls live)'
    case 'plain':
      return 'mounted (plain iframe, no shell handshake)'
    case 'failed':
      return `failed — ${state.error ?? 'unknown error'}`
    case 'mounting':
      return 'still mounting (check again with a snapshot)'
    default:
      return 'page not loaded yet'
  }
}

async function reportOpened(
  record: ViewSessionRecord,
  state: PageState | null,
  mode: 'agent' | 'system' | 'none',
  opts: ViewOpts,
): Promise<void> {
  if (isMachine(opts)) {
    output(
      {
        session: record,
        state: state?.state ?? 'unopened',
        error: state?.error,
        driver: mode === 'agent' ? { profile: VIEW_PROFILE, headed: !!opts.headed } : mode,
      },
      opts,
    )
    return
  }
  const label = `/:${record.view.route.key}`
  log.success(`View session ${chalk.bold(record.id)} — ${chalk.bold(label)}`)
  log.dim(`  target    ${record.view.target}`)
  log.dim(
    `  identity  ${record.identity ?? '(default)'}  instance  ${record.instance ?? '(active)'}`,
  )
  log.dim(`  page      ${record.pageUrl}`)
  if (state) log.dim(`  state     ${describeState(state)}`)
  console.log('')
  if (mode === 'agent') {
    console.log(chalk.bold('Drive it:'))
    console.log(`  ${driveHint(!!opts.headed)} snapshot`)
    console.log(`  ${driveHint(!!opts.headed)} click @e3`)
  } else if (mode === 'none') {
    console.log(chalk.bold('Open it:'))
    console.log(`  ${record.pageUrl}`)
  }
  console.log(`${chalk.bold('Close:')}   astrale view --close ${record.id}`)
}

export async function runSnapshotExtras(
  opts: Pick<ViewOpts, 'headed' | 'screenshot' | 'snapshot'>,
): Promise<void> {
  const target = { profile: VIEW_PROFILE, headed: !!opts.headed }
  const settled =
    opts.screenshot || opts.snapshot
      ? await waitForSettledSnapshot(() => ab(['snapshot'], target))
      : null

  if (opts.screenshot) {
    const shot = await ab(['screenshot', opts.screenshot], target)
    if (!shot.ok) log.warn(`screenshot failed: ${shot.error ?? 'unknown error'}`)
    else log.dim(`  screenshot → ${opts.screenshot}`)
  }
  if (opts.snapshot && settled) {
    if (!settled.ok) {
      log.warn(`snapshot failed: ${settled.error ?? 'unknown error'}`)
      return
    }
    console.log(snapshotText(settled) ?? JSON.stringify(settled.data, null, 2))
  }
}

async function closeCommand(opts: ViewOpts): Promise<void> {
  const sessions = await listSessions()
  let targets: ViewSessionRecord[]
  if (opts.all) targets = sessions
  else if (typeof opts.close === 'string') {
    const match = sessions.find((s) => s.id === opts.close)
    if (!match)
      return fatal(new Error(`No view session "${opts.close}" — see \`astrale view --sessions\``))
    targets = [match]
  } else if (sessions.length <= 1) targets = sessions
  else {
    return fatal(
      new Error(
        `${sessions.length} sessions open — pass --close <id> or --close --all:\n${sessions
          .map((s) => `  ${s.id}  /:${s.view.route.key}`)
          .join('\n')}`,
      ),
    )
  }
  for (const session of targets) await closeSession(session)
  if (isMachine(opts)) output({ closed: targets.map((s) => s.id) }, opts)
  else if (targets.length === 0) log.dim('No view sessions.')
  else log.success(`Closed ${targets.map((s) => s.id).join(', ')}`)
}

async function sessionsCommand(opts: ViewOpts): Promise<void> {
  const sessions = await listSessions()
  if (isMachine(opts)) {
    output(sessions, opts)
    return
  }
  if (sessions.length === 0) {
    log.dim('No view sessions.')
    return
  }
  for (const s of sessions) {
    console.log(
      `${chalk.bold(s.id)}  /:${s.view.route.key}  target ${s.view.target}  ${chalk.dim(s.pageUrl)}`,
    )
  }
}

export default {
  name: 'view',
  description: 'Open one view in a local browser shell your agent can drive',
  arguments: [
    {
      name: 'spec',
      description: 'ViewPath (/:origin:view.slug) or target node (/path or @id)',
      required: false,
    },
  ],
  options: [
    {
      flags: '--target <path>',
      description:
        'Target node to open the view on (optional — some views are standalone); @self works',
    },
    { flags: '--view <slug>', description: 'Pick a view when the target resolves several' },
    { flags: '--list', description: 'Resolve and print the candidate views; do not open' },
    {
      flags: '--view-url <url>',
      description: 'Override the view frontend URL (origin swaps origin; full URL replaces)',
    },
    {
      flags: '--handshake <mode>',
      description: 'Override the mount mode (needed with a bare --view-url)',
      choices: ['shell', 'none'],
    },
    { flags: '--headed', description: 'Visible agent-browser window' },
    { flags: '--browser', description: 'Open in the system default browser instead' },
    { flags: '--no-open', description: 'Start the session and print the URL only' },
    { flags: '--snapshot', description: 'Print an accessibility snapshot once the view is up' },
    { flags: '--screenshot <file>', description: 'Save a screenshot once the view is up' },
    { flags: '--sessions', description: 'List active view sessions' },
    {
      flags: '--close [id]',
      description: 'Close a view session (bare: the only open one; with --all: every session)',
    },
    { flags: '--all', description: 'With --close: close every session' },
    {
      flags: '--allow-external-origin <origin...>',
      description: 'Grant this View exact HTTPS origins it may open in a new browser context',
    },
  ],
  afterHelpText: `
What it does:
  Renders ONE view — no GUI, no cookies, no WorkOS. It resolves the view on the
  kernel, starts a loopback session server that supplies the shell handshake (real
  handshake via @astrale-os/shell, token minted from YOUR CLI identity, kernel
  calls proxied), and opens the page headless in agent-browser. Driving stays
  agent-browser's job; auth follows --as/--creds/-i like any kernel command.

  A session stays up ~30 min idle (heartbeat while the page is open). The view
  gets exactly what the GUI would hand it: one target-bound resolved placement,
  an audience-bound credential for shell mounts, and the kernel endpoint.

Examples:
  $ astrale view @customer
  $ astrale view /:crm.example.dev:view.dashboard
  $ astrale view /:agents.astrale.ai:view.agent --target @f00d1234 --as alice
  $ astrale view @customer --snapshot
  $ astrale view /:integrations.astrale.ai:view.application --allow-external-origin https://connect.nango.dev https://connect.composio.dev
  $ astrale view --list
  $ astrale view --sessions ; astrale view --close --all
`,
  action: async (spec: string | undefined, opts: ViewOpts) => {
    if (opts.close !== undefined) return closeCommand(opts)
    if (opts.sessions) return sessionsCommand(opts)
    if (opts.list && !spec) return sessionsCommand(opts)

    rejectUnrepresentableOverrides(opts)
    if (!spec) return fatal(new Error('Nothing to open — pass a ViewPath or target node.'))
    const wantsAgentBrowser = !opts.browser && opts.open !== false
    if ((opts.snapshot || opts.screenshot) && !wantsAgentBrowser) {
      return fatal(
        new Error('--snapshot/--screenshot need the agent-browser page (drop --browser/--no-open)'),
      )
    }
    if (wantsAgentBrowser && !(await findAgentBrowser())) {
      log.error('agent-browser is not installed — it is the engine `astrale view` drives.')
      log.dim('  npm install -g agent-browser && agent-browser install')
      log.dim(`  npx skills add ${AGENT_BROWSER_REPO}`)
      log.dim('  (or use --browser / --no-open)')
      process.exit(1)
    }

    const { view, candidates } = await resolveSession(spec, opts)
    if (opts.list) {
      if (isMachine(opts)) output(candidates, opts)
      else if (candidates.length === 0) log.dim('No views resolve here.')
      else {
        for (const c of candidates) {
          console.log(
            `${chalk.bold(candidateSlug(c))}  ${c.handshake}  ${c.origin}  ${chalk.dim(c.url)}  ${c.path}`,
          )
        }
      }
      return
    }
    if (!view) throw new Error('View resolution completed without a selected view')

    const record = await startSession(view, opts)

    let mode: 'agent' | 'system' | 'none' = 'none'
    if (wantsAgentBrowser) {
      mode = 'agent'
      const opened = await ab(['open', record.pageUrl], {
        profile: VIEW_PROFILE,
        headed: !!opts.headed,
      })
      if (!opened.ok) {
        await closeSession(record)
        return fatal(
          new Error(`agent-browser could not open the page: ${opened.error ?? 'unknown error'}`),
        )
      }
    } else if (opts.browser) {
      mode = 'system'
      openSystemBrowser(record.pageUrl)
    }

    const state = mode === 'none' ? null : await waitForPageState(record)
    if (state?.state === 'failed') {
      await reportOpened(record, state, mode, opts)
      if (opts.debug) {
        const tail = await readFile(logPath(record.id), 'utf8').catch(() => '')
        if (tail) console.error(`--- server log ---\n${tail.slice(-3000)}`)
      }
      await closeSession(record)
      process.exit(1)
    }
    await reportOpened(record, state, mode, opts)
    if (mode === 'agent') await runSnapshotExtras(opts)
  },
} satisfies CommandDefinition
