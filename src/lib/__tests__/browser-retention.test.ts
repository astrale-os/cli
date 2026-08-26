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

import type { BrowserRetentionBudget } from '../browser-retention'

import {
  DEFAULT_MAX_CACHE_BYTES,
  DEFAULT_MAX_PROFILE_AGE_DAYS,
  browserRetentionBudget,
  heldByLiveBrowser,
  profileCacheBytes,
  sweepBrowserProfiles,
} from '../browser-retention'

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

describe('age rule', () => {
  test('a dormant profile is removed outright', async () => {
    seedProfile('dormant', { idleMs: 40 * DAY, cacheBytes: 100 })
    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })
    expect(r.removed).toEqual(['dormant'])
    expect(existsSync(join(dir, 'dormant'))).toBe(false)
    expect(r.bytesFreed).toBeGreaterThan(0)
  })

  test('a recently used profile is kept', async () => {
    seedProfile('fresh', { idleMs: 2 * DAY, cacheBytes: 100 })
    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })
    expect(r.removed).toEqual([])
    expect(sessionIntact('fresh')).toBe(true)
  })

  test('the age bound is configurable', async () => {
    seedProfile('two-days', { idleMs: 2 * DAY })
    const strict = { ...BUDGET, maxProfileAgeMs: DAY }
    expect((await sweepBrowserProfiles({ dir, budget: strict })).removed).toEqual(['two-days'])
  })
})

describe('size rule', () => {
  test('a profile under budget is left completely alone', async () => {
    seedProfile('small', { idleMs: DAY, cacheBytes: 1_000 })
    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })
    expect(r.purged).toEqual([])
    expect(cacheGone('small')).toBe(false)
  })

  test('a profile over budget loses its cache but keeps its session', async () => {
    seedProfile('bloated', { idleMs: DAY, cacheBytes: 20_000 })
    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })
    expect(r.purged).toEqual(['bloated'])
    expect(cacheGone('bloated')).toBe(true)
    // The entire point: the cookie survives, so the user stays signed in.
    expect(sessionIntact('bloated')).toBe(true)
    expect(existsSync(join(dir, 'bloated'))).toBe(true)
    expect(r.bytesFreed).toBeGreaterThanOrEqual(40_000)
  })

  test('the size bound counts only cache directories, not the whole profile', async () => {
    const profile = seedProfile('measured', { idleMs: DAY, cacheBytes: 3_000 })
    writeFileSync(join(profile, 'Default', 'History'), 'z'.repeat(50_000))
    // 2 cache files of 3 KB each; History is not cache and must not count.
    expect(await profileCacheBytes(profile)).toBe(6_000)
    expect((await sweepBrowserProfiles({ dir, budget: BUDGET })).purged).toEqual([])
  })
})

describe('live-browser guard', () => {
  test('a profile locked by a live process is never touched', async () => {
    // Our own pid is unambiguously alive.
    seedProfile('in-use', { idleMs: 40 * DAY, cacheBytes: 20_000, lockPid: process.pid })
    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })
    expect(r.skipped).toEqual(['in-use'])
    expect(r.removed).toEqual([])
    expect(r.purged).toEqual([])
    expect(existsSync(join(dir, 'in-use'))).toBe(true)
    expect(cacheGone('in-use')).toBe(false)
  })

  test('a stale lock from a dead process does not protect anything', async () => {
    // Chromium leaves these behind after a crash; they must not pin disk forever.
    seedProfile('crashed', { idleMs: 40 * DAY, lockPid: 999_999 })
    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })
    expect(r.removed).toEqual(['crashed'])
  })

  test('heldByLiveBrowser reads the symlink without resolving it', () => {
    // The target names a file that does not exist — statting it would throw.
    const live = seedProfile('live', { lockPid: process.pid })
    const dead = seedProfile('dead', { lockPid: 999_999 })
    const none = seedProfile('none', {})
    expect(heldByLiveBrowser(live)).toBe(true)
    expect(heldByLiveBrowser(dead)).toBe(false)
    expect(heldByLiveBrowser(none)).toBe(false)
  })
})

describe('sweep resilience', () => {
  test('a missing browser directory is a no-op, not an error', async () => {
    const gone = join(dir, 'does-not-exist')
    const r = await sweepBrowserProfiles({ dir: gone, budget: BUDGET })
    expect(r).toEqual({ removed: [], purged: [], skipped: [], bytesFreed: 0 })
  })

  test('stray files beside the profiles are ignored', async () => {
    writeFileSync(join(dir, 'browser.json'), '{}')
    seedProfile('real', { idleMs: 40 * DAY })
    expect((await sweepBrowserProfiles({ dir, budget: BUDGET })).removed).toEqual(['real'])
  })

  test('several profiles are handled independently in one pass', async () => {
    seedProfile('a-dormant', { idleMs: 40 * DAY })
    seedProfile('b-bloated', { idleMs: DAY, cacheBytes: 20_000 })
    seedProfile('c-fine', { idleMs: DAY, cacheBytes: 100 })
    seedProfile('d-locked', { idleMs: 40 * DAY, lockPid: process.pid })
    const r = await sweepBrowserProfiles({ dir, budget: BUDGET })
    expect(r.removed).toEqual(['a-dormant'])
    expect(r.purged).toEqual(['b-bloated'])
    expect(r.skipped).toEqual(['d-locked'])
    expect(sessionIntact('c-fine')).toBe(true)
  })
})

describe('browserRetentionBudget', () => {
  test('defaults when nothing is configured', async () => {
    expect(await browserRetentionBudget()).toEqual({
      maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
      maxProfileAgeMs: DEFAULT_MAX_PROFILE_AGE_DAYS * DAY,
    })
  })

  test('env overrides both bounds', async () => {
    process.env.ASTRALE_BROWSER_MAX_CACHE_BYTES = '4096'
    process.env.ASTRALE_BROWSER_MAX_PROFILE_AGE_DAYS = '3'
    expect(await browserRetentionBudget()).toEqual({
      maxCacheBytes: 4096,
      maxProfileAgeMs: 3 * DAY,
    })
  })

  test.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['not a number', 'lots'],
  ])('a %s env value falls back to the default rather than removing the cap', async (_l, value) => {
    process.env.ASTRALE_BROWSER_MAX_CACHE_BYTES = value
    expect((await browserRetentionBudget()).maxCacheBytes).toBe(DEFAULT_MAX_CACHE_BYTES)
  })
})
