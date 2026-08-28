import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Set the home before the paths singleton is captured (dynamic imports below).
process.env.ASTRALE_HOME = mkdtempSync(join(tmpdir(), 'astrale-tele-trigger-'))

let maybeTriggerAnalysis: (argv: string[]) => void
let sessionDir: (id: string) => string
let sessionsRoot: () => string

beforeAll(async () => {
  ;({ maybeTriggerAnalysis } = await import('../trigger'))
  ;({ sessionDir, sessionsRoot } = await import('../store'))
  // Sibling test files mutate shared state (env vars, and recorder.test.ts
  // leaves a telemetry-disabled config.json in the shared home) — own it here.
  delete process.env.ASTRALE_TELEMETRY
  delete process.env.ASTRALE_TELEMETRY_ANALYZER
  delete process.env.ASTRALE_TELEMETRY_NO_TRIGGER
  const { CONFIG_PATH } = await import('../../state/index')
  rmSync(CONFIG_PATH, { force: true })
})

function seed(id: string, ageMs: number, analyzed: boolean): void {
  const dir = sessionDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id, root: '/w', explicit: false }))
  writeFileSync(join(dir, 'events.jsonl'), '{}\n')
  if (analyzed) {
    writeFileSync(
      join(dir, '.analyzed'),
      JSON.stringify({ analyzedAt: new Date().toISOString(), outcome: 'reported' }),
    )
  }
  const when = new Date(Date.now() - ageMs)
  utimesSync(join(dir, 'events.jsonl'), when, when)
}

const DAY = 24 * 60 * 60 * 1000

describe('opportunistic GC', () => {
  test('does not claim or spawn the analyzer without its dedicated opt-in', () => {
    seed('default-off-target', 60 * 60 * 1000, false)
    maybeTriggerAnalysis(['bun', 'astrale', 'status'])
    expect(existsSync(join(sessionsRoot(), '.analyzer.lock'))).toBe(false)
  })

  test('removes sessions past retention, keeps recent ones', () => {
    seed('gc-old-analyzed', 40 * DAY, true)
    seed('gc-recent-analyzed', 2 * DAY, true)
    maybeTriggerAnalysis(['bun', 'astrale', 'status'])
    expect(existsSync(sessionDir('gc-old-analyzed'))).toBe(false)
    expect(existsSync(sessionDir('gc-recent-analyzed'))).toBe(true)
  })

  test('runs with telemetry disabled — switching it off must drain the store', () => {
    seed('gc-off-old', 40 * DAY, true)
    process.env.ASTRALE_TELEMETRY = '0'
    try {
      maybeTriggerAnalysis(['bun', 'astrale', 'status'])
    } finally {
      delete process.env.ASTRALE_TELEMETRY
    }
    expect(existsSync(sessionDir('gc-off-old'))).toBe(false)
  })

  test('runs on `session` commands, which are exempt from analysis only', () => {
    seed('gc-session-cmd-old', 40 * DAY, true)
    maybeTriggerAnalysis(['bun', 'astrale', 'session', 'list'])
    expect(existsSync(sessionDir('gc-session-cmd-old'))).toBe(false)
  })

  test('honours a configured age bound', () => {
    seed('gc-two-days', 2 * DAY, true)
    process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS = '1'
    try {
      maybeTriggerAnalysis(['bun', 'astrale', 'status'])
    } finally {
      delete process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS
    }
    expect(existsSync(sessionDir('gc-two-days'))).toBe(false)
  })
})
