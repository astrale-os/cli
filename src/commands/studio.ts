import type { ChildProcess } from 'node:child_process'

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { CommandDefinition } from '../program/index'

import { AstraleError } from '../errors'
import { materializeEmbeddedAssets } from '../lib/embedded-assets'
import { fatal, log } from '../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../lib/output'
import { findFreePort, portFree } from '../lib/port'
import { run, spawnHandle } from '../lib/proc'
import { selfInvocation } from '../lib/self-invocation'

type StudioOpts = RawOutputOpts & {
  port?: string
  open?: boolean // `--open` → true. Default (undefined) prints the URL without launching a browser.
  dev?: boolean
  prod?: boolean
  harness?: string
}

// Uncommon, safe bands in the IANA Registered range (well below the OS
// ephemeral range), away from the popular dev ports (3000/5173/8080/…).
// Concurrent studios in different workspaces ladder up: 4319, 4320, 4321…
const STUDIO_PORT_BASE = 4319
const VITE_PORT_BASE = 5273
const PORT_SPAN = 20
const STUDIO_CLI_DESCRIPTOR_ENV = 'DOMAIN_STUDIO_CLI_DESCRIPTOR'

/**
 * Describe this exact CLI invocation for the Studio server. A source/published
 * script needs its entrypoint after node/bun; a Bun-compiled executable is
 * self-contained and therefore has no prefix argument.
 */
export function encodeStudioCliDescriptor(
  executable = process.execPath,
  entry = process.argv[1],
): string {
  const args =
    entry && entry !== executable && !entry.startsWith('/$bunfs') && existsSync(entry)
      ? [realpathSync(entry)]
      : []
  return JSON.stringify({ version: 1, executable, args })
}

/**
 * Locate the studio package shipped with / alongside the CLI. Anchored to the
 * resolved CLI ENTRY (process.argv[1], deref'd through any install symlink) —
 * NOT import.meta.url, which differs between the bundled dist and the unbundled
 * source run. From `<cli>/bin/astrale.ts`, `<cli>/dist/astrale.js`, or a
 * published `<pkg>/dist/astrale.js`, the studio is the sibling `../studio`.
 * `ASTRALE_STUDIO_DIR` overrides everything (point at an out-of-tree checkout).
 */
function resolveStudioDir(): string {
  const candidates: string[] = []
  if (process.env.ASTRALE_STUDIO_DIR) candidates.push(process.env.ASTRALE_STUDIO_DIR)
  try {
    const entryDir = dirname(realpathSync(process.argv[1] ?? ''))
    candidates.push(join(entryDir, '..', 'studio'), join(entryDir, 'studio'))
  } catch {
    /* argv[1] unreadable — fall through to the error below */
  }
  for (const c of candidates) {
    if (existsSync(join(c, 'server', 'index.ts'))) return resolve(c)
  }
  throw new Error(
    `Domain Studio assets not found (looked in: ${candidates.join(', ') || '<none>'}). ` +
      `Reinstall the astrale CLI, or set ASTRALE_STUDIO_DIR to a studio checkout.`,
  )
}

/** Dev iff the resolved studio dir is the monorepo source checkout. */
function isDevSource(studioDir: string): boolean {
  return (
    existsSync(join(studioDir, 'vite.config.ts')) && existsSync(join(studioDir, 'client', 'src'))
  )
}

/**
 * Resolve the Vite launcher bin. We spawn it DIRECTLY (not via `bun x vite`):
 * the pnpm `.bin/vite` shim stays inside our detached process group, so a group
 * kill reaps it cleanly — `bun x` forks Vite as a grandchild that escapes and
 * orphans. Checks the package's own node_modules first, then the hoisted root.
 */
function resolveViteBin(studioDir: string): string | null {
  for (const c of [
    join(studioDir, 'node_modules', '.bin', 'vite'),
    join(studioDir, '..', '..', 'node_modules', '.bin', 'vite'),
  ]) {
    if (existsSync(c)) return c
  }
  return null
}

/** The studio server is a Bun server (Bun.serve/import.meta.dir); fail early with a hint if Bun is absent rather than surfacing a raw child ENOENT. */
async function ensureBun(): Promise<void> {
  try {
    if ((await run('bun', ['--version'])).code === 0) return
  } catch {
    /* ENOENT — handled below */
  }
  throw new Error(
    'Domain Studio requires Bun on PATH. Install it from https://bun.sh, then re-run `astrale studio`.',
  )
}

/**
 * Poll a URL until it answers (any HTTP response = up), the deadline passes, or
 * `abort` fires. Aborting must also clear the pending retry timer: a live timer
 * keeps the event loop — and therefore the whole CLI — alive long after we
 * stopped caring about the answer.
 */
export async function waitForHttp(
  url: string,
  timeoutMs = 20_000,
  abort?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && abort?.aborted !== true) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) })
      return true
    } catch {
      await delay(150, abort)
    }
  }
  return false
}

/** Sleep, but drop the timer the moment `abort` fires so it holds nothing open. */
function delay(ms: number, abort?: AbortSignal): Promise<void> {
  if (abort?.aborted === true) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      abort?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    abort?.addEventListener('abort', done, { once: true })
  })
}

export type StudioReadiness = 'ready' | 'exited' | 'timeout'

/**
 * Wait for the studio to answer, but stop the moment the server process ends.
 *
 * The server exits on its own when it has nothing to serve — a workspace with no
 * domain, for one: it prints why and returns non-zero. Probing on regardless
 * would hold the terminal for the whole indexing budget waiting on a port nobody
 * is listening to, long after the reason was on screen. The probe is cancelled
 * on the way out so no retry timer outlives this call.
 */
export async function awaitStudioReadiness(
  probe: (abort: AbortSignal) => Promise<boolean>,
  serverDone: Promise<unknown>,
): Promise<StudioReadiness> {
  const stop = new AbortController()
  try {
    return await Promise.race([
      probe(stop.signal).then((up): StudioReadiness => (up ? 'ready' : 'timeout')),
      serverDone.then((): StudioReadiness => 'exited'),
    ])
  } finally {
    stop.abort()
  }
}

function openBrowser(url: string): void {
  // win32: `start` is a cmd.exe builtin, not a PATH executable — must go through
  // `cmd /c start "" <url>` (the empty "" is the title arg `start` consumes).
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    spawnHandle(cmd, args as string[], { stdio: 'ignore' }).unref()
  } catch {
    /* best-effort; headless ok */
  }
}

async function pickPort(
  explicit: string | undefined,
  base: number,
  label: string,
): Promise<number> {
  if (explicit !== undefined) {
    // Strict decimal — reject '4e3', '0x10D7', whitespace-padded, etc.
    const p = /^\d+$/.test(explicit) ? Number(explicit) : NaN
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`invalid --port: ${explicit}`)
    // Explicit intent must NOT be silently relocated — probe once, error if busy.
    if (!(await portFree(p))) {
      throw new Error(
        `port ${p} is busy (another studio?). Pick a free --port, or omit it to auto-select.`,
      )
    }
    return p
  }
  const p = await findFreePort(base, PORT_SPAN)
  if (p === null)
    throw new Error(`no free ${label} port in ${base}-${base + PORT_SPAN - 1}; pass --port`)
  return p
}

export default {
  name: 'studio',
  description: 'Launch the local Domain Studio GUI for a workspace',
  arguments: [
    {
      name: 'path',
      description: 'Workspace or domain dir to open (default: current dir)',
      required: false,
    },
  ],
  options: [
    { flags: '--port <n>', description: 'Studio HTTP port (default: first free in 4319-4338)' },
    {
      flags: '--open',
      description: 'Open the studio in your browser (default: just print the URL)',
    },
    {
      flags: '--dev',
      description:
        'Live-edit mode for hacking on the studio itself (Vite HMR + server reload; needs the source checkout)',
    },
    { flags: '--prod', description: 'Serve the prebuilt client (the default)' },
    {
      flags: '--harness <name>',
      description: 'Lock the agent harness for this Studio process',
      choices: ['claude', 'codex'],
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
Behavior:
  Launches the Domain Studio — a local web GUI to author and inspect a domain —
  pointed at <path> (the current directory by default), so you can run it from
  any workspace. The production Studio and its Bun 1.4 runtime are embedded in
  the standalone Astrale executable; no separate Bun or Node install is needed.

  Port: binds the first free loopback port in 4319-4338, so a studio already
  running in another workspace simply takes the next port (4320, 4321, …). An
  explicit --port is used as-is, or errors if busy (never silently relocated).

  By DEFAULT it serves the prebuilt client (fast, always works — this is what a
  standalone executable runs). --dev is the live-edit loop for hacking on the studio
  ITSELF: a Vite dev server (client HMR) + a watched server (reloads on edits) so
  studio changes reflect instantly; it requires the studio source checkout
  (cli/studio) with Vite installed.

  By default the command just PRINTS the URL — it does not pop a browser (that's
  invasive when you already have a tab open). Pass --open to launch one.

  Agent harness: choose Claude Code or Codex per domain in Studio Settings. Pass
  --harness claude|codex to lock this process to one harness. Each harness uses
  its existing local authentication and keeps an independent resumable session.

  The command stays attached and supervises its child processes; Ctrl-C tears
  them all down (a second Ctrl-C force-kills). With --json it prints a
  { url, port, mode, workspace } descriptor.

Examples:
  $ astrale studio                 # start the studio + print its URL (no browser)
  $ astrale studio --open          # …and open it in a browser
  $ astrale studio ./my-domain
  $ astrale studio --harness codex
  $ astrale studio --port 4400
  $ astrale studio --dev           # live-edit the studio itself (from source)
`,
  action: async (pathArg: string | undefined, opts: StudioOpts) => {
    try {
      const workspace = resolve(pathArg ?? process.cwd())
      if (!existsSync(workspace)) throw new Error(`path not found: ${workspace}`)

      const cliDescriptor = encodeStudioCliDescriptor()

      // Default to PROD — serve the prebuilt client. It always renders, is what a
      // published/global install runs, and avoids dev's heavy source-module graph.
      // --dev opts into the live-edit loop, which needs the studio SOURCE
      // (cli/studio) with Vite installed.
      const dev = opts.dev === true
      const studioDir = dev ? resolveStudioDir() : ''
      let viteBin: string | null = null
      if (dev) {
        await ensureBun()
        if (
          process.env.ASTRALE_STUDIO_DIR &&
          studioDir === resolve(process.env.ASTRALE_STUDIO_DIR)
        ) {
          log.dim(`  using ASTRALE_STUDIO_DIR=${studioDir}`)
        }
        if (!isDevSource(studioDir)) {
          throw new Error(
            '--dev needs the studio source checkout (cli/studio); the standalone executable runs prod only.',
          )
        }
        viteBin = resolveViteBin(studioDir)
        if (!viteBin)
          throw new Error('Vite is not installed — run `pnpm install` at the workspace root.')
      }

      const studioPort = await pickPort(opts.port, STUDIO_PORT_BASE, 'studio')
      if (opts.port === undefined && studioPort !== STUDIO_PORT_BASE) {
        log.dim(`  port ${STUDIO_PORT_BASE} busy (another studio?) — using ${studioPort}`)
      }
      const displayUrl = `http://localhost:${studioPort}`
      // The studio server binds 127.0.0.1, so we PROBE IPv4 explicitly — `localhost`
      // can resolve to ::1 first, which a 127.0.0.1-only listener won't answer.
      const probeUrl = `http://127.0.0.1:${studioPort}/`

      // Supervise the child processes. Each runs in its OWN process group
      // (detached) so one group signal tears down the whole tree — Vite, the
      // watched server, and their grandchildren (extractor / MCP islands). We
      // track liveness (so we never group-signal an exited child — PID-reuse
      // safe), escalate SIGTERM→SIGKILL on a timeout (an unresponsive child — long
      // SSE / in-flight agent turn — can't wedge the CLI), and a second Ctrl-C
      // force-kills immediately. Handlers attach synchronously at spawn, so a
      // fast-failing child is never missed and a dead child downs the rest.
      const children: ChildProcess[] = []
      const alive = new Set<ChildProcess>()
      let shuttingDown = false
      let failed = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const signalGroup = (c: ChildProcess, sig: NodeJS.Signals) => {
        if (c.pid === undefined || !alive.has(c)) return
        try {
          process.kill(-c.pid, sig) // negative pid → the process group (POSIX)
        } catch {
          try {
            c.kill(sig)
          } catch {
            /* gone, or win32 group semantics unsupported */
          }
        }
      }
      const killAll = () => {
        if (shuttingDown) {
          for (const c of children) signalGroup(c, 'SIGKILL') // second signal → escalate now
          return
        }
        shuttingDown = true
        for (const c of children) signalGroup(c, 'SIGTERM')
        killTimer = setTimeout(() => {
          for (const c of children) signalGroup(c, 'SIGKILL')
        }, 5_000)
        killTimer.unref?.()
      }
      const supervise = (c: ChildProcess, role: string): ChildProcess => {
        children.push(c)
        alive.add(c)
        c.once('error', (err) => {
          failed = true
          log.error(`studio ${role} failed: ${err instanceof Error ? err.message : String(err)}`)
          killAll()
        })
        c.once('exit', () => {
          alive.delete(c)
          if (alive.size === 0 && killTimer) clearTimeout(killTimer)
          if (!shuttingDown) {
            failed = true // a child died on its own → tear the rest down
            killAll()
          }
        })
        return c
      }
      process.on('SIGINT', killAll)
      process.on('SIGTERM', killAll)

      let serverChild: ChildProcess
      if (dev && viteBin) {
        const vitePort = await pickPort(undefined, VITE_PORT_BASE, 'vite')
        // Bind Vite to IPv4 loopback explicitly — its default `localhost` binds
        // ONLY ::1 here, which the 127.0.0.1 server-side proxy and our probe
        // can't reach. --strictPort: the server must know Vite's exact port.
        supervise(
          spawnHandle(
            viteBin,
            ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
            {
              cwd: studioDir,
              detached: true,
              // STUDIO_VITE_PORT → vite.config points the HMR WebSocket at Vite
              // directly (the page is served via the studio proxy on another port).
              env: { ...process.env, STUDIO_VITE_PORT: String(vitePort) },
            },
          ),
          'vite',
        )
        if (!(await waitForHttp(`http://127.0.0.1:${vitePort}/`))) {
          killAll()
          await new Promise((r) => setTimeout(r, 500)) // let SIGTERM land before we exit
          throw new Error(
            'Vite dev server did not start — run `pnpm install` at the workspace root, or use --prod.',
          )
        }
        serverChild = supervise(
          spawnHandle(
            'bun',
            ['--watch', 'server/index.ts', workspace, '--port', String(studioPort), '--no-open'],
            {
              cwd: studioDir,
              detached: true,
              env: {
                ...process.env,
                DOMAIN_STUDIO_DEV: '1',
                VITE_URL: `http://127.0.0.1:${vitePort}`,
                PORT: String(studioPort),
                DOMAIN_STUDIO_HOST: '127.0.0.1',
                [STUDIO_CLI_DESCRIPTOR_ENV]: cliDescriptor,
                ...(opts.harness ? { DOMAIN_STUDIO_HARNESS: opts.harness } : {}),
              },
            },
          ),
          'server',
        )
      } else {
        const dist = await materializeEmbeddedAssets('studio')
        const invocation = selfInvocation([
          '__studio-server',
          workspace,
          '--port',
          String(studioPort),
          '--no-open',
        ])
        serverChild = supervise(
          spawnHandle(invocation.file, invocation.args, {
            cwd: workspace,
            detached: true,
            env: {
              ...process.env,
              DOMAIN_STUDIO_DIST: dist,
              PORT: String(studioPort),
              DOMAIN_STUDIO_HOST: '127.0.0.1',
              [STUDIO_CLI_DESCRIPTOR_ENV]: cliDescriptor,
              ...(opts.harness ? { DOMAIN_STUDIO_HARNESS: opts.harness } : {}),
            },
          }),
          'server',
        )
      }

      // Resolve when the studio server ends (Ctrl-C, crash, or kill). Attached
      // synchronously right after spawn — never lost to a race with a fast exit.
      // NOTE: in dev the server runs under `bun --watch`, which survives an
      // uncaught crash to hot-restart on the next edit (the intended edit loop), so
      // the CLI stays attached until you Ctrl-C — which always tears it down.
      const serverDone = new Promise<number>((res) =>
        serverChild.once('exit', (code) => res(code ?? 0)),
      )

      if (!isMachine(opts)) log.step(`Starting Domain Studio${dev ? ' (dev)' : ''} — ${displayUrl}`)
      // The server binds its port before it indexes anything, so this is a wait on a
      // process starting up — seconds — not on a workspace being introspected, which
      // now happens behind the open port. A server that gives up first (no domain
      // found, a lost port) ends the wait right there instead: it already told the
      // user why, and the terminal is theirs again immediately. We open the browser
      // once it actually answers.
      const readiness = await awaitStudioReadiness(
        (abort) => waitForHttp(probeUrl, 60_000, abort),
        serverDone,
      )
      if (readiness === 'exited') {
        const code = await serverDone
        // A user Ctrl-C mid-indexing is not a failure — carry the server's own
        // signal code out. Anything else stopped on its own and must be fatal.
        if (!failed) {
          process.exitCode = code
          return
        }
        throw new Error(
          `the Domain Studio server stopped before it was ready (exit ${code}) — see its output above.`,
        )
      }
      const ready = readiness === 'ready'
      if (isMachine(opts)) {
        output({ url: displayUrl, port: studioPort, mode: dev ? 'dev' : 'prod', workspace }, opts)
      } else {
        // "Serving", not "finished". The server answers as soon as it is listening and
        // indexes the workspace behind that — so this must not read as a promise that
        // every canvas is ready. The server's own `n/N` lines below say when they are.
        log.success(`Domain Studio serving${dev ? ' (dev — live reload)' : ''}`)
        log.dim(`  ${workspace}`)
        log.dim(`  → ${displayUrl}`)
        if (!ready) log.warn('Still starting — open the URL above once the server answers.')
      }
      if (ready && opts.open === true) openBrowser(displayUrl)

      // Stay attached until the studio server ends; surface a non-zero code when a
      // child FAILURE (not a user Ctrl-C) drove the teardown.
      const code = await serverDone
      process.exitCode = failed && code === 0 ? 1 : code
    } catch (e) {
      fatal(
        e instanceof AstraleError
          ? e
          : new AstraleError('STUDIO_START_FAILED', e instanceof Error ? e.message : String(e)),
        opts,
      )
    }
  },
} satisfies CommandDefinition
