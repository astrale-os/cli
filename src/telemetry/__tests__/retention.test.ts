import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { sweepByAge, sweepStore, sweepToBudget, tidySession } from '../retention'
import { retentionBudget } from '../settings'
import { scanSessions, sessionDir, sessionsRoot } from '../store'
import { maybeTriggerAnalysis } from '../trigger'
import { DAY, seedSession, useTelemetryHome } from './fixture'

const telemetry = useTelemetryHome()
const BUDGET = { maxAgeMs: 30 * DAY, maxBytes: 10_000 }
const alive = (id: string) => existsSync(sessionDir(id))

describe('session store retention', () => {
  test('scans newest first; closed and analyzed come from two stats', () => {
    seedSession('old', { ageMs: DAY, analyzed: 'error' })
    seedSession('new')
    seedSession('quiet', { events: false })
    mkdirSync(join(sessionsRoot(), '.hidden'))

    expect(scanSessions()).toMatchObject([
      { id: 'new', closed: false, analyzed: false },
      { id: 'old', closed: true, analyzed: true },
      { id: 'quiet', lastEventAt: null, closed: false },
    ])
  })

  test('the age sweep drops expired sessions within its cap, never eventless or protected ones', () => {
    for (const id of ['a', 'b', 'c']) seedSession(id, { ageMs: 31 * DAY })
    seedSession('recent', { ageMs: DAY })
    seedSession('running', { events: false })

    expect(
      sweepByAge(scanSessions(), { budget: BUDGET, limit: 1, protect: new Set(['a']) }).removed,
    ).toHaveLength(1)
    sweepByAge(scanSessions(), { budget: BUDGET, protect: new Set(['a']) })
    expect(['a', 'b', 'c', 'recent', 'running'].filter(alive)).toEqual(['a', 'recent', 'running'])
  })

  test('the size sweep evicts closed sessions oldest first and analyzed before unanalyzed', () => {
    seedSession('analyzed-new', { ageMs: 2 * DAY, analyzed: 'reported', bytes: 4_000 })
    seedSession('plain-old', { ageMs: 5 * DAY, bytes: 4_000 })
    seedSession('plain-older', { ageMs: 6 * DAY, bytes: 4_000 })
    seedSession('open', { bytes: 4_000 })
    seedSession('protected', { ageMs: 9 * DAY, bytes: 4_000 })

    const { removed } = sweepToBudget(scanSessions(), {
      budget: BUDGET,
      protect: new Set(['protected']),
    })
    expect(removed).toEqual(['analyzed-new', 'plain-older', 'plain-old'])
    expect(alive('open') && alive('protected')).toBe(true)
  })

  test('tidying keeps only durable artifacts, and the prompt of a failed analysis', () => {
    seedSession('done', { ageMs: DAY, analyzed: 'reported' })
    seedSession('failed', { ageMs: DAY, analyzed: 'error' })
    for (const id of ['done', 'failed']) {
      writeFileSync(join(sessionDir(id), 'analyzer-prompt.md'), 'prompt')
      mkdirSync(join(sessionDir(id), 'scratch'))
      writeFileSync(join(sessionDir(id), 'scratch', 'calls.txt'), 'x'.repeat(20_000))
    }

    expect(sweepStore({ budget: BUDGET }).removed).toEqual([])
    expect(readdirSync(sessionDir('done')).sort()).toEqual([
      '.analyzed',
      'events.jsonl',
      'meta.json',
    ])
    expect(readdirSync(sessionDir('failed'))).toContain('analyzer-prompt.md')
    expect(tidySession('missing')).toEqual([])
  })

  test('every CLI start sweeps by age, even with telemetry off, and spawns no analyzer without opt-in', () => {
    seedSession('expired', { ageMs: 31 * DAY })
    seedSession('closed', { ageMs: DAY })
    telemetry.configure({ enabled: false })

    maybeTriggerAnalysis(['bun', 'astrale', 'session', 'list'])
    expect(alive('expired')).toBe(false)
    expect(alive('closed')).toBe(true)

    telemetry.configure({ enabled: true, maxAgeDays: 0.5 })
    maybeTriggerAnalysis(['bun', 'astrale', 'status'])
    expect(alive('closed')).toBe(false)
    expect(existsSync(join(sessionsRoot(), '.analyzer.lock'))).toBe(false)
  })

  test('the budget comes from the environment, then config, then defaults; invalid values fall through', () => {
    expect(retentionBudget()).toEqual({ maxAgeMs: 30 * DAY, maxBytes: 50 * 1024 * 1024 })
    telemetry.configure({ maxAgeDays: 7, maxBytes: 0 })
    process.env.ASTRALE_TELEMETRY_MAX_BYTES = '2048'
    process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS = 'soon'
    expect(retentionBudget()).toEqual({ maxAgeMs: 7 * DAY, maxBytes: 2048 })
  })
})
