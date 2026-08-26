import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RetentionBudget } from '../settings'

// Set the home before the paths singleton is captured (dynamic imports below).
process.env.ASTRALE_HOME = mkdtempSync(join(tmpdir(), 'astrale-tele-settings-'))

let retentionBudget: () => RetentionBudget
let telemetryEnabled: () => boolean
let DEFAULT_MAX_AGE_DAYS: number
let DEFAULT_MAX_BYTES: number
let configPath: string

const DAY = 24 * 60 * 60 * 1000

beforeAll(async () => {
  const settings = await import('../settings')
  retentionBudget = settings.retentionBudget
  telemetryEnabled = settings.telemetryEnabled
  DEFAULT_MAX_AGE_DAYS = settings.DEFAULT_MAX_AGE_DAYS
  DEFAULT_MAX_BYTES = settings.DEFAULT_MAX_BYTES
  configPath = join(process.env.ASTRALE_HOME!, 'config.json')
})

function writeConfig(telemetry: unknown): void {
  writeFileSync(configPath, JSON.stringify({ telemetry }))
}

beforeEach(() => {
  rmSync(configPath, { force: true })
  delete process.env.ASTRALE_TELEMETRY
  delete process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS
  delete process.env.ASTRALE_TELEMETRY_MAX_BYTES
})

afterEach(() => {
  rmSync(configPath, { force: true })
  delete process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS
  delete process.env.ASTRALE_TELEMETRY_MAX_BYTES
})

describe('retentionBudget', () => {
  test('defaults when nothing is configured', () => {
    expect(retentionBudget()).toEqual({
      maxAgeMs: DEFAULT_MAX_AGE_DAYS * DAY,
      maxBytes: DEFAULT_MAX_BYTES,
    })
  })

  test('reads both bounds from config.json', () => {
    writeConfig({ maxAgeDays: 7, maxBytes: 1_048_576 })
    expect(retentionBudget()).toEqual({ maxAgeMs: 7 * DAY, maxBytes: 1_048_576 })
  })

  test('env wins over config', () => {
    writeConfig({ maxAgeDays: 7, maxBytes: 1_048_576 })
    process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS = '2'
    process.env.ASTRALE_TELEMETRY_MAX_BYTES = '4096'
    expect(retentionBudget()).toEqual({ maxAgeMs: 2 * DAY, maxBytes: 4096 })
  })

  test('a bad env value falls through to config rather than unbounding the store', () => {
    writeConfig({ maxAgeDays: 7 })
    process.env.ASTRALE_TELEMETRY_MAX_AGE_DAYS = 'soon'
    expect(retentionBudget().maxAgeMs).toBe(7 * DAY)
  })

  test.each([
    ['zero', 0],
    ['negative', -1],
    ['not a number', 'lots'],
    ['null', null],
  ])('%s config values fall back to the default', (_label, maxBytes) => {
    writeConfig({ maxBytes })
    expect(retentionBudget().maxBytes).toBe(DEFAULT_MAX_BYTES)
  })

  test('a broken config yields defaults instead of throwing', () => {
    writeFileSync(configPath, '{ not json')
    expect(retentionBudget().maxBytes).toBe(DEFAULT_MAX_BYTES)
  })
})

describe('telemetryEnabled', () => {
  test('on by default, and unaffected by retention keys', () => {
    writeConfig({ maxAgeDays: 7 })
    expect(telemetryEnabled()).toBe(true)
  })

  test('off via config', () => {
    writeConfig({ enabled: false })
    expect(telemetryEnabled()).toBe(false)
  })

  test.each(['0', 'false', 'off', 'OFF', ' off '])('off via ASTRALE_TELEMETRY=%p', (value) => {
    process.env.ASTRALE_TELEMETRY = value
    expect(telemetryEnabled()).toBe(false)
  })
})
