import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

import type { CommandDefinition } from '../../../command'

import {
  astraleArgv,
  needsAstraleManager,
  readDevState,
  requireAstraleManager,
  resolveDomainPlatform,
  resolveWorkerPort,
} from '../../../adapters/domain-platform'
import { mapBounded } from '../../../lib/concurrency'
import { resolveDomainDirs } from '../../../lib/domain-discovery'
import { paths } from '../../../lib/env'
import { followLogs } from '../../../lib/follow-logs'
import { fatal, log } from '../../../lib/log'
import { type DomainResult, labelFor, printResults, printSummary } from './_shared'

type Opts = {
  kernel: string
  domain: string
  cwd?: string
  platform?: string
  views?: 'built' | 'hmr'
  follow?: boolean
}

const FOLLOW_STOP_NOTE =
  'log follow stopped — worker(s) still running · `astrale domain dev down` to stop'

/** Wrangler log path for a domain (slug = its dev-up label). */
function wranglerLog(label: string): string {
  return join(paths.domainLogDir(label), 'wrangler.log')
}

/**
 * With `--follow`, stream the logs of every domain that came up, until Ctrl-C.
 * Follows the live (ok) ones even when a sibling failed — the failure is
 * already in the recap above, and one bad domain shouldn't suppress watching
 * the rest. No-op without `--follow` or when nothing came up. The fan-out's
 * children are never passed `--follow`, so only the top-level invocation
 * attaches the stream.
 *
 * Call sites place this BEFORE the failure-exit: with `--follow` it blocks
 * until Ctrl-C; without it, this returns and the `exit(1)`-on-failure fires.
 */
async function followLive(opts: Opts, results: DomainResult[]): Promise<void> {
  if (!opts.follow) return
  const live = results.filter((r) => r.ok)
  if (live.length === 0) return
  await followLogs(
    live.map((r) => ({ label: r.label, file: wranglerLog(r.label) })),
    FOLLOW_STOP_NOTE,
  )
}

/** Last non-empty line of captured child output — the surfaced error. */
function lastMeaningfulLine(s: string): string | undefined {
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.at(-1)
}

/** Tail of the most relevant on-disk log for a failed domain. */
function tailLog(slug: string, lines = 15): string | undefined {
  const dir = paths.domainLogDir(slug)
  for (const name of ['wrangler.log', 'vite-build.log']) {
    const p = join(dir, name)
    if (!existsSync(p)) continue
    const content = readFileSync(p, 'utf-8').trimEnd()
    if (!content) continue
    return `${name}:\n${content.split('\n').slice(-lines).join('\n')}`
  }
  return undefined
}

/** Attach recap data: port + state on success, log tail on failure. */
function enrich(r: DomainResult, port: number | null): DomainResult {
  r.port = port ?? undefined
  if (r.ok) {
    r.state = readDevState(paths.domainState(r.label)) ?? undefined
  } else {
    r.logTail = tailLog(r.label)
  }
  return r
}

/**
 * Minimal in-place progress line. NO ora / Proxy / cursor library —
 * just `\r` rewrites of one line, and only when stdout is a real TTY (a
 * pipe / CI / non-interactive run gets nothing and the recap alone).
 * Children are spawned `detached`, so an interactive child shell can't
 * steal the tty and SIGTTOU us mid-render.
 */
function startTicker(total: number): { tick: (done: number) => void; stop: () => void } {
  if (!process.stdout.isTTY) return { tick: () => {}, stop: () => {} }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let frame = 0
  let done = 0
  const id = setInterval(() => {
    frame = (frame + 1) % frames.length
    process.stdout.write(`\r${frames[frame]} dev up — ${done}/${total} ready\x1b[K`)
  }, 80)
  return {
    tick: (d) => {
      done = d
    },
    stop: () => {
      clearInterval(id)
      process.stdout.write('\r\x1b[K')
    },
  }
}

/**
 * Run one domain as a child `astrale domain dev up --cwd <dir>`. The
 * child resolves to exactly that one domain (discovery stops at the
 * first match) → hits the in-process single-domain path → never fans
 * out again (recursion-safe). Output is buffered and only surfaced via
 * the recap; live wrangler/vite output already goes to log files.
 */
function runChild(dir: string, label: string, opts: Opts): Promise<DomainResult> {
  const [bun, entry] = astraleArgv()
  const args = [
    entry,
    'domain',
    'dev',
    'up',
    '--cwd',
    dir,
    '--kernel',
    opts.kernel,
    '--domain',
    opts.domain,
    '--platform',
    opts.platform ?? 'cloudflare',
    // Note: `--follow` is intentionally NOT forwarded — only the top-level
    // invocation streams; children just start their worker and return.
    ...(opts.views ? ['--views', opts.views] : []),
  ]
  return new Promise<DomainResult>((resolve) => {
    // detached: true → the child gets its own session (setsid) with NO
    // controlling terminal. `devUp` spawns an *interactive* `zsh -lic`
    // (needed for the macOS-TCC PATH workaround); an interactive shell
    // calls tcsetpgrp() to grab the controlling tty. Without isolation
    // the concurrent children steal the foreground from this parent, and
    // the parent's ora spinner then writes to a backgrounded tty →
    // SIGTTOU → `astrale` itself suspends ("suspended (tty output)").
    // Own session = no tty to steal. stdio is piped (not inherited), so
    // we still capture everything and `close` still fires.
    const child = spawn(bun, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let buf = ''
    child.stdout?.on('data', (d: Buffer) => (buf += d))
    child.stderr?.on('data', (d: Buffer) => (buf += d))
    child.on('error', (e) => resolve({ dir, label, ok: false, error: e.message }))
    child.on('close', (code) => {
      // Silent here: the group worker prints this domain's line (via
      // printResultLine) the moment runChild resolves.
      if (code === 0) {
        resolve({ dir, label, ok: true })
      } else {
        resolve({
          dir,
          label,
          ok: false,
          error: lastMeaningfulLine(buf) ?? `exited with code ${code ?? '?'}`,
        })
      }
    })
  })
}

export default {
  name: 'up',
  description:
    'Restart local dev infrastructure for every domain found under the cwd (wrangler + optional tunnel/manager). Falls back to the single enclosing domain when run from inside one. Pass --follow to then stream the worker log(s) live.',
  options: [
    {
      flags: '--kernel <name>',
      description: 'Kernel preset, applied to every domain (default: local:manager:inprocess)',
      default: 'local:manager:inprocess',
    },
    {
      flags: '--domain <name>',
      description: 'Domain preset, applied to every domain (default: local:inprocess)',
      default: 'local:inprocess',
    },
    {
      flags: '--cwd <path>',
      description: 'Directory to scan for domains (default: current working directory)',
    },
    {
      flags: '--platform <id>',
      description: 'DomainPlatform adapter id (default: cloudflare)',
      default: 'cloudflare',
    },
    {
      flags: '--views <mode>',
      description:
        "How the worker serves its /ui/* SPA: 'built' (fresh vite build) | 'hmr' (live Vite dev server). Overrides each domain's lifecycle.ts config.views; default is per-domain config, else built.",
    },
    {
      flags: '-f, --follow',
      description:
        'After starting, stream the worker log(s) live until Ctrl-C (the worker keeps running).',
    },
  ],
  action: async (opts: Opts) => {
    const platform = resolveDomainPlatform(opts.platform)

    if (opts.views !== undefined && opts.views !== 'built' && opts.views !== 'hmr') {
      fatal(`--views must be 'built' or 'hmr' (got '${opts.views}')`)
    }

    let dirs: string[]
    try {
      dirs = await resolveDomainDirs(opts.cwd)
    } catch (e) {
      fatal(e)
    }

    // Single domain → in-process. Also the recursion base case: every
    // child below runs `up --cwd <dir>` which lands here with one dir.
    if (dirs.length <= 1) {
      const results: DomainResult[] = []
      for (const dir of dirs) {
        const label = labelFor(dir)
        log.step(`restarting ${label} (${dir})`)
        try {
          await platform.devDown({ domainDir: dir })
          const state = await platform.devUp({
            domainDir: dir,
            kernel: opts.kernel,
            domain: opts.domain,
            views: opts.views,
          })
          const port = await resolveWorkerPort(dir, opts.domain).catch(() => null)
          results.push({ dir, label, ok: true, state, port: port ?? undefined })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          log.error(`${label}: ${msg}`)
          results.push({ dir, label, ok: false, error: msg })
        }
      }
      printSummary('dev up', results)
      await followLive(opts, results)
      if (results.some((r) => !r.ok)) process.exit(1)
      return
    }

    // ── Multi-domain fan-out ────────────────────────────────────────
    // 1. Assert shared infra ONCE — `dev up` no longer auto-starts the
    //    manager, so a down manager fails fast here (once, not per child).
    //    Quiet: the status is folded into the consolidated header below.
    let managerPart = ''
    if (needsAstraleManager(opts.kernel)) {
      try {
        requireAstraleManager({ quiet: true, kernelPreset: opts.kernel })
        managerPart = 'manager up'
      } catch (e) {
        fatal(e)
      }
    }

    // 2. Group by resolved wrangler port. Domains sharing a port reuse
    //    one wrangler ⇒ must be serialised relative to each other; an
    //    unresolvable port → singleton group (child surfaces the error).
    const ports = await Promise.all(
      dirs.map((dir) => resolveWorkerPort(dir, opts.domain).catch(() => null)),
    )
    const portByDir = new Map<string, number | null>(dirs.map((dir, i) => [dir, ports[i] ?? null]))
    const labelByDir = new Map<string, string>(dirs.map((dir) => [dir, labelFor(dir)]))
    const groups = new Map<string, string[]>()
    dirs.forEach((dir, i) => {
      const key = ports[i] === null ? `solo:${dir}` : `port:${ports[i]}`
      const g = groups.get(key)
      if (g) g.push(dir)
      else groups.set(key, [dir])
    })
    const groupList = [...groups.values()]
    const total = dirs.length
    const bound = Math.min(groupList.length, os.availableParallelism?.() ?? 4)

    // 3. Consolidated header up front — everything in it is known before
    //    the fan-out. "groups" shown only when something is actually
    //    serialised (groupList < total), else it's invisible noise.
    const parts = [
      `${total} domains`,
      groupList.length < total ? `${groupList.length} groups ∥${bound}` : `∥${bound}`,
      ...(managerPart ? [managerPart] : []),
      `kernel=${opts.kernel} domain=${opts.domain}`,
    ]
    log.step(`dev up — ${parts.join(' · ')}`)

    // 4. Port-groups in parallel (bounded), sequential within a group.
    //    A single self-erasing progress line ticks while they run; the
    //    sorted per-domain recap prints once everything has settled.
    const ticker = startTicker(total)
    let done = 0
    const perGroup = await mapBounded(groupList, bound, async (group) => {
      const out: DomainResult[] = []
      for (const dir of group) {
        const label = labelByDir.get(dir) ?? labelFor(dir)
        const r = enrich(await runChild(dir, label, opts), portByDir.get(dir) ?? null)
        ticker.tick(++done)
        out.push(r)
      }
      return out
    })
    ticker.stop()

    // Recap in discovery order (stable), not completion order.
    const byDir = new Map(perGroup.flat().map((r) => [r.dir, r]))
    const results = dirs.map(
      (dir) =>
        byDir.get(dir) ?? {
          dir,
          label: labelByDir.get(dir) ?? labelFor(dir),
          ok: false,
          error: 'no result',
        },
    )
    printResults(results)
    await followLive(opts, results)
    if (results.some((r) => !r.ok)) process.exit(1)
  },
} satisfies CommandDefinition
