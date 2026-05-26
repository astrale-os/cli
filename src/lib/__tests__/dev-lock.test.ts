import { describe, expect, test } from 'bun:test'

import { isStale, type LockData } from '../dev-lock'

// `isStale` is the load-bearing decision (which locks may be reclaimed).
// Pinned with process.pid (guaranteed alive) and a huge pid (effectively
// dead) — no filesystem, no singleton paths. The acquire/release fs dance
// is covered by the end-to-end verification.
const live = process.pid
const dead = 0x7fffffff // 2147483647 — not a live pid in practice
const now = () => new Date().toISOString()
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function lock(partial: Partial<LockData>): LockData {
  return { pid: live, startedAt: now(), ...partial }
}

describe('isStale', () => {
  test('missing/empty/unparseable lock (null) → stale', () => {
    expect(isStale(null)).toBe(true)
  })

  test('live holder, fresh → NOT stale (a real concurrent run is refused)', () => {
    expect(isStale(lock({ pid: live, startedAt: now() }))).toBe(false)
  })

  test('dead holder → stale (reclaim)', () => {
    expect(isStale(lock({ pid: dead, startedAt: now() }))).toBe(true)
  })

  test('older than the 10-min TTL → stale even if the pid is live (PID-reuse escape)', () => {
    expect(isStale(lock({ pid: live, startedAt: ago(11 * 60_000) }))).toBe(true)
  })

  test('just under the TTL, live → NOT stale', () => {
    expect(isStale(lock({ pid: live, startedAt: ago(9 * 60_000) }))).toBe(false)
  })

  test('unparseable startedAt → stale', () => {
    expect(isStale(lock({ pid: live, startedAt: 'not-a-date' }))).toBe(true)
  })
})
