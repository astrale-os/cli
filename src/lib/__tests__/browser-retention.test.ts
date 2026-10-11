import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BrowserRetentionBudget } from '../browser/retention'

import {
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_PROFILE_AGE_DAYS,
  browserRetentionBudget,
  profileCacheBytes,
  sweepBrowserProfiles,
} from '../browser/retention'

const DAY = 24 * 60 * 60 * 1000
const BUDGET: BrowserRetentionBudget = { maxCacheBytes: 10_000, maxProfileAgeMs: 30 * DAY }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrale-browser-ret-'))
  delete process.env.ASTRALE_BROWSER_MAX_CACHE_BYTES
  delete process.env.ASTRALE_BROWSER_MAX_PROFILE_AGE_DAYS
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

type Seed = { idleMs?: number; cacheBytes?: number; lockPid?: number }

/** A profile shaped like Chromium's: session state at the root and in Default/,
 *  cache in the subdirectories retention is allowed to delete. */
function seedProfile(name: string, { idleMs = 0, cacheBytes = 0, lockPid }: Seed): string {
  const profile = join(dir, name)
  mkdirSync(join(profile, 'Default'), { recursive: true })
  writeFileSync(join(profile, 'Local State'), '{"os_crypt":{"encrypted_key":"x"}}')
  writeFileSync(join(profile, 'Default', 'Cookies'), 'SQLite format 3\0cookie-data')
  writeFileSync(join(profile, 'Default', 'Preferences'), '{"profile":{}}')
  mkdirSync(join(profile, 'Default', 'Local Storage', 'leveldb'), { recursive: true })
  writeFileSync(join(profile, 'Default', 'Local Storage', 'leveldb', '000003.log'), 'state')

  if (cacheBytes > 0) {
    mkdirSync(join(profile, 'Default', 'Cache', 'Cache_Data'), { recursive: true })
    writeFileSync(
      join(profile, 'Default', 'Cache', 'Cache_Data', 'f_000001'),
      'x'.repeat(cacheBytes),
    )
    mkdirSync(join(profile, 'Default', 'Code Cache', 'js'), { recursive: true })
    writeFileSync(join(profile, 'Default', 'Code Cache', 'js', 'index'), 'y'.repeat(cacheBytes))
  }
  if (lockPid !== undefined) {
    symlinkSync(`${hostname()}-${lockPid}`, join(profile, 'SingletonLock'))
  }
  const when = new Date(Date.now() - idleMs)
  utimesSync(profile, when, when)
  return profile
}

const sessionIntact = (name: string): boolean =>
  existsSync(join(dir, name, 'Default', 'Cookies')) &&
  existsSync(join(dir, name, 'Local State')) &&
  existsSync(join(dir, name, 'Default', 'Preferences')) &&
  existsSync(join(dir, name, 'Default', 'Local Storage', 'leveldb', '000003.log'))

const cacheGone = (name: string): boolean =>
  !existsSync(join(dir, name, 'Default', 'Cache')) &&
  !existsSync(join(dir, name, 'Default', 'Code Cache'))

describe('browser profile sweep', () => {
  test('removes dormant profiles, purges only the cache of bloated ones, never touches a live one', async () => {
    writeFileSync(join(dir, 'browser.json'), '{}')
    seedProfile('a-dormant', { idleMs: 40 * DAY, cacheBytes: 100 })
    // Chromium leaves stale locks behind after a crash; they must not pin disk forever.
    seedProfile('b-crashed', { idleMs: 40 * DAY, lockPid: 999_999 })
    seedProfile('c-bloated', { idleMs: DAY, cacheBytes: 20_000 })
    seedProfile('d-fine', { idleMs: 2 * DAY, cacheBytes: 1_000 })
    // Our own pid is unambiguously alive.
    seedProfile('e-locked', { idleMs: 40 * DAY, cacheBytes: 20_000, lockPid: process.pid })

    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })

    expect(r).toMatchObject({
      removed: ['a-dormant', 'b-crashed'],
      purged: ['c-bloated'],
      skipped: ['e-locked'],
    })
    expect(r.bytesFreed).toBeGreaterThanOrEqual(40_000)
    expect(existsSync(join(dir, 'a-dormant'))).toBe(false)
    // The entire point: the cookie survives, so the user stays signed in.
    expect(cacheGone('c-bloated') && sessionIntact('c-bloated')).toBe(true)
    expect(cacheGone('d-fine') || cacheGone('e-locked')).toBe(false)
    expect(sessionIntact('d-fine') && sessionIntact('e-locked')).toBe(true)

    const strict = { ...BUDGET, maxProfileAgeMs: DAY }
    expect((await sweepBrowserProfiles({ dir, budget: strict })).removed).toEqual([
      'c-bloated',
      'd-fine',
    ])
    expect(await sweepBrowserProfiles({ dir: join(dir, 'gone'), budget: BUDGET })).toEqual({
      removed: [],
      purged: [],
      skipped: [],
      bytesFreed: 0,
    })
  })

  test('the size bound counts only cache directories, not the whole profile', async () => {
    const profile = seedProfile('measured', { idleMs: DAY, cacheBytes: 3_000 })
    writeFileSync(join(profile, 'Default', 'History'), 'z'.repeat(50_000))
    // 2 cache files of 3 KB each; History is not cache and must not count.
    expect(await profileCacheBytes(profile)).toBe(6_000)
    expect((await sweepBrowserProfiles({ dir, budget: BUDGET })).purged).toEqual([])
  })
})

test('the retention budget defaults, follows the environment, and never drops a cap', async () => {
  expect(await browserRetentionBudget()).toEqual({
    maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
    maxProfileAgeMs: DEFAULT_MAX_PROFILE_AGE_DAYS * DAY,
  })
  process.env.ASTRALE_BROWSER_MAX_CACHE_BYTES = '4096'
  process.env.ASTRALE_BROWSER_MAX_PROFILE_AGE_DAYS = '3'
  expect(await browserRetentionBudget()).toEqual({ maxCacheBytes: 4096, maxProfileAgeMs: 3 * DAY })
  for (const value of ['0', '-1', 'lots']) {
    process.env.ASTRALE_BROWSER_MAX_CACHE_BYTES = value
    expect((await browserRetentionBudget()).maxCacheBytes).toBe(DEFAULT_MAX_CACHE_BYTES)
  }
})
