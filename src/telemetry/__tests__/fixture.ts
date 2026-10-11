import { afterEach, beforeEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eventsPath, markerPath, metaPath, sessionDir } from '../store'

export const DAY = 24 * 60 * 60 * 1000

const ENVIRONMENT = [
  'ASTRALE_HOME',
  'ASTRALE_SESSION',
  'ASTRALE_TELEMETRY',
  'ASTRALE_TELEMETRY_ANALYZER',
  'ASTRALE_TELEMETRY_NO_TRIGGER',
  'ASTRALE_TELEMETRY_MAX_AGE_DAYS',
  'ASTRALE_TELEMETRY_MAX_BYTES',
] as const

/** Give every test its own ASTRALE_HOME and a telemetry environment free of overrides. */
export function useTelemetryHome() {
  let home = ''
  const saved = new Map<string, string | undefined>()
  beforeEach(() => {
    for (const name of ENVIRONMENT) {
      saved.set(name, process.env[name])
      delete process.env[name]
    }
    home = mkdtempSync(join(tmpdir(), 'astrale-telemetry-'))
    process.env.ASTRALE_HOME = home
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  return {
    home: () => home,
    configure: (telemetry: Record<string, unknown>) =>
      writeFileSync(join(home, 'config.json'), JSON.stringify({ telemetry })),
  }
}

export type Seed = {
  root?: string
  ageMs?: number
  analyzed?: 'reported' | 'error'
  /** Bytes of report.md. */
  bytes?: number
  events?: boolean
}

export function seedSession(
  id: string,
  { root = '/w', ageMs = 0, analyzed, bytes = 0, events = true }: Seed = {},
): void {
  mkdirSync(sessionDir(id), { recursive: true })
  writeFileSync(metaPath(id), JSON.stringify({ id, root, explicit: false, createdAt: '' }))
  if (bytes > 0) writeFileSync(join(sessionDir(id), 'report.md'), 'x'.repeat(bytes))
  if (analyzed) writeFileSync(markerPath(id), JSON.stringify({ analyzedAt: '', outcome: analyzed }))
  if (!events) return
  writeFileSync(eventsPath(id), '{}\n')
  const when = new Date(Date.now() - ageMs)
  utimesSync(eventsPath(id), when, when)
}
