/**
 * Identity-based reaper for a domain's local `wrangler dev` worker.
 *
 * Why not just kill by port? A wrangler stuck mid-reload is NOT listening,
 * so `lsof -ti :PORT` is empty and it survives — then the next `dev up`
 * spawns another, and ≥2 wranglers for the same worker collide and loop
 * forever. The fix is to identify our wrangler/workerd processes by their
 * **working directory** (the immutable, always-present fact — the launcher
 * `cd`s into the worker dir and `workerd` inherits it), regardless of
 * whether they currently hold the port.
 *
 * Identity (exact, role-specific):
 *   - `workerd` whose realpath(cwd) === realpath(workerDir), OR
 *   - a node process whose argv contains `wrangler` + `dev` and whose
 *     realpath(cwd) === realpath(workerDir).
 * Hard exclusions (never reaped): comm ∈ {vite, esbuild}, or cwd === the
 * `worker/client` dir (the HMR Vite dev server + its bundler live there).
 *
 * Cross-platform discovery: Linux reads `/proc/<pid>/{comm,cwd,cmdline}`
 * (Alpine-safe, no tooling); macOS/BSD uses `ps` + `lsof -d cwd` and seeds
 * candidates via `pgrep` (no `/proc`). Each kill is an individual
 * `process.kill(pid, 'SIGKILL')` — never a process-group fan-out, because
 * reparenting to launchd severs the PPID/PGID chain and workerd often
 * `setsid`s into its own group (a group kill would miss it or hit the
 * login shell).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'

import { AstraleError } from '../../errors'
import { confirm } from '../../lib/prompt'
import { killPids, listenersOnPort } from './cloudflare-helpers'

export type ProcIdentity = { pid: number; comm: string; cwd: string; argv: string[] }

const isLinux = process.platform === 'linux'

function realpathSafe(p: string): string | null {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

function lsofBin(): string {
  return existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof'
}

function macCwd(pid: number): string | null {
  // `-Fn` → field output: a line `n<path>` carries the cwd.
  const r = spawnSync(lsofBin(), ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
    encoding: 'utf-8',
  })
  if (r.status !== 0) return null
  for (const line of (r.stdout ?? '').split('\n')) {
    if (line.startsWith('n')) return realpathSafe(line.slice(1)) ?? line.slice(1)
  }
  return null
}

/** Resolve a process's comm/cwd/argv, or null if it vanished / is unreadable. */
export function procIdentity(pid: number): ProcIdentity | null {
  if (pid <= 0) return null
  try {
    if (isLinux) {
      const comm = readFileSync(`/proc/${pid}/comm`, 'utf-8').trim()
      const cwd = realpathSafe(`/proc/${pid}/cwd`)
      if (cwd === null) return null
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').filter(Boolean)
      return { pid, comm, cwd, argv }
    }
    const ps = spawnSync('ps', ['-o', 'comm=,command=', '-p', String(pid)], { encoding: 'utf-8' })
    if (ps.status !== 0 || !ps.stdout?.trim()) return null
    const line = ps.stdout.trim()
    const firstSpace = line.indexOf(' ')
    const commPath = firstSpace === -1 ? line : line.slice(0, firstSpace)
    const command = firstSpace === -1 ? '' : line.slice(firstSpace + 1)
    const cwd = macCwd(pid)
    if (cwd === null) return null
    return {
      pid,
      comm: basename(commPath),
      cwd,
      argv: command.length > 0 ? command.split(/\s+/) : [commPath],
    }
  } catch {
    return null
  }
}

/** True iff `id` is this worker's wrangler launcher or its workerd. */
export function isOurWorker(id: ProcIdentity, workerDirReal: string): boolean {
  // Never reap the HMR Vite dev server or a bundler — neither is ours.
  if (id.comm === 'vite' || id.comm === 'esbuild') return false
  const cwdReal = realpathSafe(id.cwd) ?? id.cwd
  const clientReal = realpathSafe(join(workerDirReal, 'client'))
  if (clientReal !== null && cwdReal === clientReal) return false
  if (cwdReal !== workerDirReal) return false
  if (id.comm === 'workerd') return true
  const nodeish = id.comm === 'node' || id.comm.startsWith('node')
  const hasWrangler = id.argv.some((a) => a.includes('wrangler'))
  const hasDev = id.argv.includes('dev')
  return nodeish && hasWrangler && hasDev
}

function scanProcLinux(workerDirReal: string): number[] {
  const pids: number[] = []
  let entries: string[]
  try {
    entries = readdirSync('/proc')
  } catch {
    return pids
  }
  for (const entry of entries) {
    const pid = Number.parseInt(entry, 10)
    if (!Number.isFinite(pid) || pid <= 0) continue
    if (realpathSafe(`/proc/${pid}/cwd`) === workerDirReal) pids.push(pid)
  }
  return pids
}

function pgrepCandidates(): number[] {
  const pids = new Set<number>()
  for (const args of [
    ['-f', 'wrangler'],
    ['-x', 'workerd'],
  ]) {
    const r = spawnSync('pgrep', args, { encoding: 'utf-8' })
    for (const s of (r.stdout ?? '').split('\n')) {
      const n = Number.parseInt(s, 10)
      if (Number.isFinite(n) && n > 0) pids.add(n)
    }
  }
  return [...pids]
}

function candidatePids(workerDirReal: string, managedPort: number): number[] {
  const pids = new Set<number>(listenersOnPort(managedPort))
  for (const pid of isLinux ? scanProcLinux(workerDirReal) : pgrepCandidates()) pids.add(pid)
  pids.delete(process.pid)
  return [...pids]
}

function ourHoldersOf(port: number, workerDirReal: string): number[] {
  return listenersOnPort(port).filter((p) => {
    const id = procIdentity(p)
    return id !== null && isOurWorker(id, workerDirReal)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type ReapResult = {
  killedOurs: number
  portFreed: boolean
  foreign: 'none' | 'killed' | 'aborted'
}

/**
 * Reap this worker's wrangler/workerd by identity, then resolve the port:
 *   - `foreignPolicy: 'ignore'` (devDown) — kill ours, leave anything else.
 *   - `foreignPolicy: 'abort'` (devUp pre-spawn) — after reaping ours, if a
 *     FOREIGN process still holds the port: `force` kills it; else prompt
 *     (auto-false off-TTY) → kill or throw PORT_HELD_BY_FOREIGN.
 */
export async function reapWorkerWranglers(
  workerDir: string,
  managedPort: number,
  opts: { foreignPolicy: 'abort' | 'ignore'; force: boolean },
): Promise<ReapResult> {
  const workerDirReal = realpathSafe(workerDir) ?? workerDir

  let killedOurs = 0
  for (const pid of candidatePids(workerDirReal, managedPort)) {
    const id = procIdentity(pid)
    if (id !== null && isOurWorker(id, workerDirReal)) killedOurs += killPids([pid]).killed
  }

  // Drain: wait until the port is free or only non-ours remain.
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const ours = ourHoldersOf(managedPort, workerDirReal)
    if (listenersOnPort(managedPort).length === 0 || ours.length === 0) break
    killPids(ours)
    await sleep(150)
  }

  if (opts.foreignPolicy === 'ignore') {
    return { killedOurs, portFreed: listenersOnPort(managedPort).length === 0, foreign: 'none' }
  }

  // devUp: ensure the port is ours-free before spawning.
  const holders = listenersOnPort(managedPort)
  if (holders.length === 0) return { killedOurs, portFreed: true, foreign: 'none' }

  const foreign = holders.filter((p) => {
    const id = procIdentity(p)
    return !(id !== null && isOurWorker(id, workerDirReal))
  })
  if (foreign.length === 0) {
    // Only ours still holding (a slow exit) — reap and report.
    killPids(holders)
    return { killedOurs, portFreed: listenersOnPort(managedPort).length === 0, foreign: 'none' }
  }

  const describe = foreign
    .map((p) => {
      const id = procIdentity(p)
      return id !== null ? `pid ${p} (${id.comm}, cwd ${id.cwd})` : `pid ${p}`
    })
    .join(', ')

  const kill =
    opts.force ||
    (await confirm(`Port :${managedPort} is held by another process [${describe}]. Kill it?`))
  if (kill) {
    killPids(foreign)
    return { killedOurs, portFreed: listenersOnPort(managedPort).length === 0, foreign: 'killed' }
  }
  throw new AstraleError(
    'PORT_HELD_BY_FOREIGN',
    `Port :${managedPort} is held by another process [${describe}].`,
    'Give this domain a unique worker port in envs.ts, stop the other process, or re-run with --force.',
  )
}
