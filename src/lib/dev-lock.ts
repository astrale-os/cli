/**
 * Per-slug advisory lock for `astrale domain dev up`.
 *
 * Two concurrent `dev up` for the same domain share one `state.json`, one
 * `wrangler.log`, and one worker port — and, worse, the identity reaper
 * keyed on the (identical) worker dir would have each run silently kill the
 * other's just-spawned wrangler: a self-inflicted reload loop. This lock
 * makes the reap→build→spawn critical section single-writer per slug.
 *
 * The exclusive `O_EXCL` create IS the mutual-exclusion primitive; the
 * `{pid, startedAt}` payload is written into that same fd afterwards. A
 * process killed between the create and the write leaves an empty/partial
 * lock — which `readLock` cannot parse and `isStale` therefore treats as
 * stealable, so a crash can never wedge a slug permanently.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { AstraleError } from '../errors'
import { paths } from './env'
import { isPidAlive } from './proc'

/** A lock older than this is reclaimed regardless of holder liveness — the
 *  PID-reuse escape hatch (a recycled pid could otherwise read as "alive"
 *  forever and wedge every future `dev up` for the slug). */
const STALE_MS = 10 * 60_000

export type LockData = { pid: number; startedAt: string }

function lockPath(slug: string): string {
  return join(paths.domainStateDir(slug), 'dev.lock')
}

/** Parse the lock; null if missing, empty, unparseable, or pid-less. */
function readLock(path: string): LockData | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LockData>
    if (typeof raw.pid !== 'number' || raw.pid <= 0) return null
    return { pid: raw.pid, startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '' }
  } catch {
    return null
  }
}

/** A null/empty/unparseable lock, a dead holder, or an aged lock is stale. */
export function isStale(lock: LockData | null): boolean {
  if (lock === null) return true
  if (!isPidAlive(lock.pid)) return true
  const started = Date.parse(lock.startedAt)
  if (!Number.isFinite(started)) return true
  return Date.now() - started > STALE_MS
}

function createLock(path: string): void {
  const fd = openSync(path, 'wx') // O_EXCL — throws EEXIST if a lock exists
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  } finally {
    closeSync(fd)
  }
}

/**
 * Acquire the slug's dev lock. Throws `DEV_LOCK_HELD` if a live peer holds
 * it; reclaims a stale lock once. Pair with `releaseDevLock` in a `finally`.
 */
export function acquireDevLock(slug: string): void {
  const path = lockPath(slug)
  mkdirSync(paths.domainStateDir(slug), { recursive: true })
  try {
    createLock(path)
    return
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  const existing = readLock(path)
  if (!isStale(existing)) {
    throw new AstraleError(
      'DEV_LOCK_HELD',
      `another dev up is running for ${slug} (pid ${existing?.pid})`,
      'Wait for it to finish or stop it. Stale locks (dead pid or >10 min old) reclaim automatically.',
    )
  }
  rmSync(path, { force: true })
  createLock(path) // EEXIST here (a rare double-steal race) surfaces loudly
}

/** Best-effort release. Safe to call even if the lock was never acquired. */
export function releaseDevLock(slug: string): void {
  try {
    rmSync(lockPath(slug), { force: true })
  } catch {
    // best-effort
  }
}
