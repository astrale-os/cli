import chalk from 'chalk'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, openSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { CommandDefinition } from '../command'
import type { KernelCommandOpts } from '../kernel'
import type { ViewServeConfig, ViewSessionRecord } from '../lib/view/session'

import { AstraleError } from '../errors'
import { bindGraph, expandSelfInPath, resolveKernelTarget, withKernelClient } from '../kernel'
import { ab, AGENT_BROWSER_REPO, BROWSER_DIR, findAgentBrowser } from '../lib/browser'
import { readConfig } from '../lib/config'
import { readIdentities } from '../lib/identity'
import { readInstances } from '../lib/instance'
import { fatal, log } from '../lib/log'
import { isMachine, output, type RawOutputOpts } from '../lib/output'
import { findFreePort } from '../lib/port'
import { run, spawnHandle } from '../lib/proc'
import {
  applyViewUrlOverride,
  candidateSlug,
  parseViewSpec,
  pickCandidate,
  resolveViewCandidates,
  rewriteLocalViewUrl,
  type ViewCandidate,
} from '../lib/view/resolve'
import { ensureViewerAssets } from '../lib/view/server'
import {
  closeSession,
  configPath,
  listSessions,
  logPath,
  saveRecord,
  VIEW_DIR,
} from '../lib/view/session'
import { snapshotText, waitForSettledSnapshot } from '../lib/view/snapshot'

/**
 * `astrale view` — open ONE view in an emulated host shell, authenticated as
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

type ResolvedTarget = { id: string; path: string }
type ResolvedView = {
  url: string
  functionId: string
  handshake: 'shell' | 'none'
  path?: string
  name?: string
}

export async function resolveSession(
  spec: string | undefined,
  opts: ViewOpts,
): Promise<{ view?: ResolvedView; target?: ResolvedTarget; candidates: ViewCandidate[] }> {
  const parsed = spec ? parseViewSpec(spec) : undefined
  if (parsed?.kind === 'target' && opts.target) {
    fatal(new Error('Pass the target either as the positional or as --target, not both'))
  }
  const targetInput = parsed?.kind === 'target' ? parsed.path : opts.target

  const resolved = await withKernelClient(opts, async (ctx) => {
    let target: ResolvedTarget | undefined
    if (targetInput) {
      const { path } = await expandSelfInPath(targetInput, opts)
      const node = (await bindGraph(ctx).get(path)) as { id?: string } | null
      if (!node?.id) {
        throw new AstraleError('NOT_FOUND', `target ${path} not found or not visible`)
      }
      target = { id: node.id, path }
    }
    // A bare --view-url already identifies the frontend. Its target is only
    // shell context, so asking View:resolve for installed candidates is both
    // unnecessary and incorrect for classes without a class-owned self view.
    const anchor = parsed ? (parsed.kind === 'view' ? parsed.path : target?.path) : undefined
    const candidates = anchor ? await resolveViewCandidates(ctx, anchor) : []
    return { target, candidates }
  })

  // Bare --view-url: mount an arbitrary URL as a view (nothing installed yet).
  if (!parsed) {
    return {
      view: {
        url: rewriteLocalViewUrl(opts.viewUrl!),
        functionId: 'dev-view',
        handshake: opts.handshake ?? 'shell',
        name: 'dev',
      },
      target: resolved.target,
      candidates: [],
    }
  }

  const anchor = parsed.kind === 'view' ? parsed.path : resolved.target!.path
  if (opts.list) {
    return { target: resolved.target, candidates: resolved.candidates }
  }
  const picked = await chooseCandidate(resolved.candidates, anchor, opts)
  let url = picked.url
  if (opts.viewUrl) url = applyViewUrlOverride(url, opts.viewUrl)
  url = rewriteLocalViewUrl(url)
  return {
    view: {
      url,
      functionId: picked.id,
      handshake: opts.handshake ?? picked.handshake ?? 'shell',
      path: picked.path,
      name: candidateSlug(picked),
    },
    target: resolved.target,
    candidates: resolved.candidates,
  }
}

async function chooseCandidate(
  candidates: ViewCandidate[],
  anchor: string,
  opts: ViewOpts,
): Promise<ViewCandidate> {
  const picked = pickCandidate(candidates, anchor, opts.view)
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
async function resolveServeRuntime(): Promise<{ file: string; args: string[] }> {
  const entry = process.argv[1]
  const node = await findOnPath('node')
  if (node && entry?.endsWith('.js') && existsSync(entry)) return { file: node, args: [entry] }
  if (node && entry?.endsWith('.ts')) {
    const dist = join(dirname(entry), '..', 'dist', 'astrale.js')
    await ensureDevDist(entry, dist)
    if (existsSync(dist)) return { file: node, args: [dist] }
  }
  return { file: process.execPath, args: entry && existsSync(entry) ? [entry] : [] }
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
  const bun = (
    globalThis as {
      Bun?: { build: (o: object) => Promise<{ success: boolean; logs: unknown[] }> }
    }
  ).Bun
  if (!bun) return
  const srcDir = join(dirname(entry), '..', 'src')
  if (existsSync(dist) && !(await newerThan(srcDir, statSync(dist).mtimeMs))) return
  // stderr: --json consumers parse stdout.
  console.error('(dev) building dist/astrale.js for the session server…')
  await bun.build({
    entrypoints: [entry],
    outdir: dirname(dist),
    target: 'node',
    format: 'esm',
  })
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
async function startSession(
  view: ResolvedView,
  target: ResolvedTarget | undefined,
  opts: ViewOpts,
): Promise<ViewSessionRecord> {
  await ensureViewerAssets()
  const config = await readConfig()
  const kernelTarget = await resolveKernelTarget(opts, config)
  const port = await findFreePort(VIEW_PORT_BASE, VIEW_PORT_SPAN)
  if (port === null) {
    fatal(
      new Error(
        `No free port in ${VIEW_PORT_BASE}-${VIEW_PORT_BASE + VIEW_PORT_SPAN - 1} — close sessions with \`astrale view --close --all\``,
      ),
    )
  }

  const [instances, identities] = await Promise.all([readInstances(), readIdentities()])
  const id = `v-${randomBytes(3).toString('hex')}`
  const nonce = randomBytes(12).toString('hex')
  const record: ViewSessionRecord = {
    id,
    pid: 0,
    port,
    nonce,
    pageUrl: `http://127.0.0.1:${port}/s/${nonce}/`,
    view,
    target,
    instance: opts.instance ?? (opts.url ? opts.url : instances.active),
    identity: opts.creds ? '(pre-signed creds)' : (opts.as ?? identities.default),
    createdAt: new Date().toISOString(),
  }
  const serveConfig: ViewServeConfig = {
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
      caFile: kernelTarget.caFile,
      direct: isPublicHttps(kernelTarget.url) && !kernelTarget.caFile,
    },
    idleMs: IDLE_MS,
  }

  await mkdir(VIEW_DIR, { recursive: true })
  await writeFile(configPath(id), JSON.stringify(serveConfig, null, 2))
  const logFd = openSync(logPath(id), 'a')
  const runtime = await resolveServeRuntime()
  const child = spawnHandle(
    runtime.file,
    [...runtime.args, '__view-serve', '--config', configPath(id)],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  )
  child.unref()
  closeSync(logFd)
  if (!child.pid) fatal(new Error('Failed to spawn the view session server'))
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
  return fatal(
    new Error(
      `View session server did not come up.${tail ? `\n--- server log ---\n${tail.slice(-2000)}` : ''}`,
    ),
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
  const label = record.view.path ?? record.view.url
  log.success(`View session ${chalk.bold(record.id)} — ${chalk.bold(label)}`)
  if (record.target) log.dim(`  target    ${record.target.path} (${record.target.id})`)
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
          .map((s) => `  ${s.id}  ${s.view.path ?? s.view.url}`)
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
      `${chalk.bold(s.id)}  ${s.view.path ?? s.view.url}${s.target ? `  target ${s.target.path}` : ''}  ${chalk.dim(s.pageUrl)}`,
    )
  }
}

export default {
  name: 'view',
  description: 'Open one view in an emulated host shell your agent can drive',
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
  ],
  afterHelpText: `
What it does:
  Renders ONE view — no GUI, no cookies, no WorkOS. It resolves the view on the
  kernel, starts a loopback session server that emulates the shell host (real
  handshake via @astrale-os/shell, token minted from YOUR CLI identity, kernel
  calls proxied), and opens the page headless in agent-browser. Driving stays
  agent-browser's job; auth follows --as/--creds/-i like any kernel command.

  A session stays up ~30 min idle (heartbeat while the page is open). The view
  gets exactly what the GUI would hand it: a delegation token, a kernel URL,
  and your target node id.

Examples:
  $ astrale view /crm/customers/ada                      # views on a node
  $ astrale view /:crm.acme.dev:view.dashboard           # explicit ViewPath
  $ astrale view /:agents.astrale.ai:view.agent --target @f00d1234 --as alice
  $ astrale view /crm/customers/ada --snapshot           # open + show it
  $ astrale view /:d:view.x --view-url http://localhost:8787   # local frontend, live data
  $ astrale view --view-url http://localhost:8787/ui/x --handshake shell --target /a/b
  $ astrale view --sessions ; astrale view --close --all
`,
  action: async (spec: string | undefined, opts: ViewOpts) => {
    if (opts.close !== undefined) return closeCommand(opts)
    if (opts.sessions) return sessionsCommand(opts)

    if (!spec && !opts.viewUrl) {
      return fatal(
        new Error('Nothing to open — pass a ViewPath or target node, or --view-url <url>.'),
      )
    }
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

    const { view, target, candidates } = await resolveSession(spec, opts)
    if (opts.list) {
      if (isMachine(opts)) output(candidates, opts)
      else if (candidates.length === 0) log.dim('No views resolve here.')
      else {
        for (const c of candidates) {
          console.log(
            `${chalk.bold(candidateSlug(c))}  ${c.handshake ?? 'shell'}  ${c.origin}  ${chalk.dim(c.url)}  ${c.path}`,
          )
        }
      }
      return
    }
    if (!view) throw new Error('View resolution completed without a selected view')

    const record = await startSession(view, target, opts)

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
