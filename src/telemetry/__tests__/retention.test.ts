import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SweepOptions, SweepResult } from '../retention'
import type { RetentionBudget } from '../settings'
import type { SessionScan } from '../store'

// Set the home before the paths singleton is captured (dynamic imports below).
process.env.ASTRALE_HOME = mkdtempSync(join(tmpdir(), 'astrale-tele-retention-'))

let sweepByAge: (sessions: readonly SessionScan[], options?: SweepOptions) => SweepResult
let sweepToBudget: (sessions: readonly SessionScan[], options?: SweepOptions) => SweepResult
let sweepStore: (options?: SweepOptions) => SweepResult
let tidySession: (id: string, options?: { keepPrompt?: boolean }) => string[]
let scanSessions: () => SessionScan[]
let sessionDir: (id: string) => string
let sessionBytes: (id: string) => number
let sessionsRoot: () => string

const DAY = 24 * 60 * 60 * 1000
const BUDGET: RetentionBudget = { maxAgeMs: 30 * DAY, maxBytes: 10_000 }

beforeAll(async () => {
  ;({ sweepByAge, sweepToBudget, sweepStore, tidySession } = await import('../retention'))
  ;({ scanSessions, sessionDir, sessionBytes, sessionsRoot } = await import('../store'))
})

beforeEach(() => {
  // Destructive cleanup must be provably confined to this file's mkdtemp home.
  if (!sessionsRoot().startsWith(tmpdir())) throw new Error('refusing to clean a non-tmp home')
  rmSync(sessionsRoot(), { recursive: true, force: true })
  delete process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS
  delete process.env.ASTRALE_TELEMETRY_MAX_BYTES
})

afterEach(() => {
  rmSync(sessionsRoot(), { recursive: true, force: true })
})

type Seed = { ageMs?: number; analyzed?: boolean; bytes?: number; events?: boolean }

function seed(id: string, { ageMs = 0, analyzed = false, bytes = 0, events = true }: Seed): void {
  const dir = sessionDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id, root: '/w', explicit: false }))
  if (bytes > 0) writeFileSync(join(dir, 'report.md'), 'x'.repeat(bytes))
  if (analyzed) {
    writeFileSync(
      join(dir, '.analyzed'),
      JSON.stringify({ analyzedAt: new Date().toISOString(), outcome: 'reported' }),
    )
  }
  if (!events) return
  writeFileSync(join(dir, 'events.jsonl'), '{}\n')
  const when = new Date(Date.now() - ageMs)
  utimesSync(join(dir, 'events.jsonl'), when, when)
}

const alive = (id: string): boolean => existsSync(sessionDir(id))

describe('sweepByAge', () => {
  test('drops sessions past the age bound whether or not they were analyzed', () => {
    seed('old-analyzed', { ageMs: 40 * DAY, analyzed: true })
    seed('old-unanalyzed', { ageMs: 40 * DAY })
    seed('recent-analyzed', { ageMs: 2 * DAY, analyzed: true })
    seed('recent-unanalyzed', { ageMs: 2 * DAY })

    const { removed } = sweepByAge(scanSessions(), { budget: BUDGET })

    expect(removed.sort()).toEqual(['old-analyzed', 'old-unanalyzed'])
    expect(alive('recent-analyzed')).toBe(true)
    expect(alive('recent-unanalyzed')).toBe(true)
  })

  test('never touches a session with no events — that is the invocation running now', () => {
    seed('no-events-yet', { events: false })
    expect(sweepByAge(scanSessions(), { budget: BUDGET }).removed).toEqual([])
    expect(alive('no-events-yet')).toBe(true)
  })

  test('honours the removal cap so a backlog drains over several runs', () => {
    for (let i = 0; i < 5; i++) seed(`stale-${i}`, { ageMs: 40 * DAY, analyzed: true })
    expect(sweepByAge(scanSessions(), { budget: BUDGET, limit: 2 }).removed).toHaveLength(2)
    expect(scanSessions()).toHaveLength(3)
  })

  test('respects the configured age bound', () => {
    seed('week-old', { ageMs: 8 * DAY, analyzed: true })
    const strict: RetentionBudget = { ...BUDGET, maxAgeMs: 7 * DAY }
    expect(sweepByAge(scanSessions(), { budget: strict }).removed).toEqual(['week-old'])
  })

  test('protected ids survive the age bound', () => {
    seed('old-but-mine', { ageMs: 40 * DAY, analyzed: true })
    const options = { budget: BUDGET, protect: new Set(['old-but-mine']) }
    expect(sweepByAge(scanSessions(), options).removed).toEqual([])
    expect(alive('old-but-mine')).toBe(true)
  })
})

describe('sweepToBudget', () => {
  test('does nothing while the store fits', () => {
    seed('small', { ageMs: DAY, analyzed: true, bytes: 100 })
    expect(sweepToBudget(scanSessions(), { budget: BUDGET }).removed).toEqual([])
    expect(alive('small')).toBe(true)
  })

  test('evicts oldest-first until the store is back under budget', () => {
    seed('oldest', { ageMs: 5 * DAY, analyzed: true, bytes: 4_000 })
    seed('middle', { ageMs: 3 * DAY, analyzed: true, bytes: 4_000 })
    seed('newest', { ageMs: DAY, analyzed: true, bytes: 4_000 })

    // 3 × ~4 KB against a 5 KB bound: two must go, and the newest must stay.
    const { removed } = sweepToBudget(scanSessions(), { budget: { ...BUDGET, maxBytes: 5_000 } })

    expect(removed).toEqual(['oldest', 'middle'])
    expect(alive('newest')).toBe(true)
  })

  test('evicts analyzed sessions before unanalyzed ones of any age', () => {
    seed('unanalyzed-oldest', { ageMs: 9 * DAY, bytes: 6_000 })
    seed('analyzed-newest', { ageMs: DAY, analyzed: true, bytes: 6_000 })

    expect(sweepToBudget(scanSessions(), { budget: BUDGET }).removed).toEqual(['analyzed-newest'])
    expect(alive('unanalyzed-oldest')).toBe(true)
  })

  test('falls through to unanalyzed sessions when analyzed ones are not enough', () => {
    seed('unanalyzed-old', { ageMs: 9 * DAY, bytes: 6_000 })
    seed('analyzed-old', { ageMs: 8 * DAY, analyzed: true, bytes: 6_000 })
    seed('unanalyzed-new', { ageMs: DAY, bytes: 6_000 })

    const { removed } = sweepToBudget(scanSessions(), { budget: BUDGET })

    expect(removed).toEqual(['analyzed-old', 'unanalyzed-old'])
    expect(alive('unanalyzed-new')).toBe(true)
  })

  test('never evicts an open session, even when that leaves the store over budget', () => {
    // No age offset → inside IDLE_WINDOW_MS → open.
    seed('open-and-huge', { analyzed: true, bytes: 20_000 })
    expect(sweepToBudget(scanSessions(), { budget: BUDGET }).removed).toEqual([])
    expect(alive('open-and-huge')).toBe(true)
  })

  test('never evicts a protected session', () => {
    seed('just-analyzed', { ageMs: DAY, analyzed: true, bytes: 20_000 })
    const options = { budget: BUDGET, protect: new Set(['just-analyzed']) }
    expect(sweepToBudget(scanSessions(), options).removed).toEqual([])
  })

  test('counts nested analyzer output — a session is bounded by all it holds', () => {
    seed('nested', { ageMs: DAY, analyzed: true, bytes: 100 })
    mkdirSync(join(sessionDir('nested'), 'scratch'), { recursive: true })
    writeFileSync(join(sessionDir('nested'), 'scratch', 'dump.txt'), 'x'.repeat(5_000))

    expect(sessionBytes('nested')).toBeGreaterThan(5_000)
  })
})

describe('sweepStore', () => {
  test('applies age first, then trims what survives to the size bound', () => {
    seed('expired', { ageMs: 40 * DAY, analyzed: true, bytes: 6_000 })
    seed('fresh-big', { ageMs: 2 * DAY, analyzed: true, bytes: 6_000 })
    seed('fresh-small', { ageMs: DAY, analyzed: true, bytes: 100 })

    // Age alone frees 6 KB, leaving ~6.1 KB — already under the 10 KB bound,
    // so the size pass must find nothing left to do.
    expect(sweepStore({ budget: BUDGET }).removed).toEqual(['expired'])
    expect(alive('fresh-big')).toBe(true)
    expect(alive('fresh-small')).toBe(true)
  })

  test('reads its budget from the environment when none is passed', () => {
    process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS = '1'
    seed('two-days-old', { ageMs: 2 * DAY, analyzed: true })
    expect(sweepStore().removed).toEqual(['two-days-old'])
  })
})

describe('sweepStore tidying', () => {
  test('tidies analyzed survivors, so the bound applies to sessions already on disk', () => {
    seed('store-tidy', { ageMs: DAY, analyzed: true, bytes: 100 })
    writeFileSync(join(sessionDir('store-tidy'), 'calls.txt'), 'x'.repeat(50_000))

    sweepStore({ budget: BUDGET })

    expect(existsSync(join(sessionDir('store-tidy'), 'calls.txt'))).toBe(false)
    expect(existsSync(join(sessionDir('store-tidy'), 'report.md'))).toBe(true)
  })

  test('an unanalyzed session is left alone — its analyzer may still be running', () => {
    seed('store-pending', { ageMs: DAY, bytes: 100 })
    writeFileSync(join(sessionDir('store-pending'), 'analyzer-prompt.md'), '# in flight')

    sweepStore({ budget: BUDGET })

    expect(existsSync(join(sessionDir('store-pending'), 'analyzer-prompt.md'))).toBe(true)
  })

  test('scratch is tidied before the size bound is measured, not after', () => {
    // 60 KB of scratch against a 10 KB budget: tidying first brings the store
    // back under on its own, so nothing should be evicted.
    seed('store-bloated', { ageMs: DAY, analyzed: true, bytes: 100 })
    writeFileSync(join(sessionDir('store-bloated'), 'calls.txt'), 'x'.repeat(60_000))

    expect(sweepStore({ budget: BUDGET }).removed).toEqual([])
    expect(existsSync(sessionDir('store-bloated'))).toBe(true)
  })

  test('a failed analysis keeps its prompt through the sweep', () => {
    const dir = sessionDir('store-failed')
    seed('store-failed', { ageMs: DAY, analyzed: true })
    writeFileSync(
      join(dir, '.analyzed'),
      JSON.stringify({ analyzedAt: new Date().toISOString(), outcome: 'error', note: 'boom' }),
    )
    writeFileSync(join(dir, 'analyzer-prompt.md'), '# what we asked')

    sweepStore({ budget: BUDGET })

    expect(existsSync(join(dir, 'analyzer-prompt.md'))).toBe(true)
  })
})

describe('tidySession', () => {
  test('removes what the analyzer left behind, keeps the durable artifacts', () => {
    const dir = sessionDir('tidy-scratch')
    seed('tidy-scratch', { ageMs: DAY, analyzed: true, bytes: 100 })
    writeFileSync(join(dir, 'analyzer.log'), 'exit 0')
    writeFileSync(join(dir, 'analyzer-prompt.md'), '# prompt')
    // Scratch: the analyzer runs with Write in here and answers to nobody.
    writeFileSync(join(dir, 'calls.txt'), 'x'.repeat(50_000))
    mkdirSync(join(dir, 'notes'), { recursive: true })
    writeFileSync(join(dir, 'notes', 'draft.md'), 'scratch')

    const removed = tidySession('tidy-scratch')

    expect(removed.sort()).toEqual(['analyzer-prompt.md', 'calls.txt', 'notes'])
    for (const keep of ['meta.json', 'events.jsonl', 'report.md', '.analyzed', 'analyzer.log']) {
      expect(existsSync(join(dir, keep))).toBe(true)
    }
    expect(existsSync(join(dir, 'notes'))).toBe(false)
  })

  test('keepPrompt spares the prompt — the failing case is when it matters', () => {
    const dir = sessionDir('tidy-failed')
    seed('tidy-failed', { ageMs: DAY, analyzed: true })
    writeFileSync(join(dir, 'analyzer-prompt.md'), '# prompt')
    writeFileSync(join(dir, 'scratch.json'), '{}')

    expect(tidySession('tidy-failed', { keepPrompt: true })).toEqual(['scratch.json'])
    expect(existsSync(join(dir, 'analyzer-prompt.md'))).toBe(true)
  })

  test('a session with nothing to tidy is left exactly as it was', () => {
    seed('tidy-clean', { ageMs: DAY, analyzed: true, bytes: 10 })
    expect(tidySession('tidy-clean')).toEqual([])
    expect(existsSync(sessionDir('tidy-clean'))).toBe(true)
  })

  test('a missing session directory is a no-op, not an error', () => {
    expect(tidySession('tidy-absent')).toEqual([])
  })
})
