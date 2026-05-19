import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

import type { CommandDefinition } from '../../../command'

import {
  astraleArgv,
  ensureAstraleManager,
  needsAstraleManager,
  readDevState,
  resolveDomainPlatform,
  resolveWorkerPort,
} from '../../../adapters/domain-platform'
import { mapBounded } from '../../../lib/concurrency'
import { resolveDomainDirs } from '../../../lib/domain-discovery'
import { paths } from '../../../lib/env'
import { fatal, log } from '../../../lib/log'
import { type DomainResult, labelFor, printSummary } from './_shared'

type Opts = {
  kernel: string
  domain: string
  cwd?: string
  platform?: string
  views?: 'built' | 'hmr'
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
 * Run one domain as a child `astrale domain dev up --cwd <dir>`. The
 * child resolves to exactly that one domain (discovery stops at the
 * first match) → hits the in-process single-domain path → never fans
 * out again (recursion-safe). Output is buffered and only surfaced via
 * the recap; live wrangler/vite output already goes to log files.
 */
function runChild(dir: string, opts: Opts): Promise<DomainResult> {
  const label = labelFor(dir)
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
    ...(opts.views ? ['--views', opts.views] : []),
  ]
  return new Promise<DomainResult>((resolve) => {
    const child = spawn(bun, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    child.stdout?.on('data', (d: Buffer) => (buf += d))
    child.stderr?.on('data', (d: Buffer) => (buf += d))
    child.on('error', (e) => resolve({ dir, label, ok: false, error: e.message }))
    child.on('close', (code) => {
      if (code === 0) {
        log.success(label)
        resolve({ dir, label, ok: true })
      } else {
        log.error(`${label} — exit ${code ?? '?'}`)
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
    'Restart local dev infrastructure for every domain found under the cwd (wrangler + optional tunnel/manager). Falls back to the single enclosing domain when run from inside one.',
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
      if (results.some((r) => !r.ok)) process.exit(1)
      return
    }

    // ── Multi-domain fan-out ────────────────────────────────────────
    // 1. Ensure shared infra ONCE — kills the cold-start race (N parallel
    //    children racing check-then-act would each try `astrale start`).
    const headerLines: string[] = []
    if (needsAstraleManager(opts.kernel)) {
      try {
        const { started } = ensureAstraleManager()
        headerLines.push(`astrale manager: ${started ? 'started' : 'already running'}`)
      } catch (e) {
        fatal(e)
      }
    }
    headerLines.push(`kernel=${opts.kernel}  domain=${opts.domain}`)

    // 2. Group by resolved wrangler port. Domains sharing a port reuse
    //    one wrangler ⇒ must be serialised relative to each other; an
    //    unresolvable port → singleton group (child surfaces the error).
    const ports = await Promise.all(
      dirs.map((dir) => resolveWorkerPort(dir, opts.domain).catch(() => null)),
    )
    const groups = new Map<string, string[]>()
    dirs.forEach((dir, i) => {
      const key = ports[i] === null ? `solo:${dir}` : `port:${ports[i]}`
      const g = groups.get(key)
      if (g) g.push(dir)
      else groups.set(key, [dir])
    })
    const groupList = [...groups.values()]

    // 3. Port-groups in parallel (bounded); sequential within a group.
    const bound = Math.min(groupList.length, os.availableParallelism?.() ?? 4)
    log.step(
      `dev up — ${dirs.length} domains across ${groupList.length} port-group${groupList.length === 1 ? '' : 's'} (≤${bound} in parallel)`,
    )
    const perGroup = await mapBounded(groupList, bound, async (group) => {
      const out: DomainResult[] = []
      for (const dir of group) out.push(await runChild(dir, opts))
      return out
    })

    // 4. Flatten back to discovery order for a stable, enriched recap.
    const byDir = new Map<string, DomainResult>()
    for (const g of perGroup) for (const r of g) byDir.set(r.dir, r)
    const results = dirs.map((dir, i) => {
      const r = byDir.get(dir) ?? { dir, label: labelFor(dir), ok: false, error: 'no result' }
      return enrich(r, ports[i] ?? null)
    })

    printSummary('dev up', results, headerLines)
    if (results.some((r) => !r.ok)) process.exit(1)
  },
} satisfies CommandDefinition
