import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SessionInfo, SessionScan } from '../store'

// Set the home before the paths singleton is captured (dynamic imports below).
process.env.ASTRALE_HOME = mkdtempSync(join(tmpdir(), 'astrale-tele-scan-'))

let scanSessions: (now?: number) => SessionScan[]
let listSessions: (now?: number) => SessionInfo[]
let readMeta: (id: string) => { root: string; explicit: boolean } | null
let sessionDir: (id: string) => string
let sessionsRoot: () => string
let IDLE_WINDOW_MS: number

const DAY = 24 * 60 * 60 * 1000

beforeAll(async () => {
  const store = await import('../store')
  scanSessions = store.scanSessions
  listSessions = store.listSessions
  readMeta = store.readMeta as typeof readMeta
  sessionDir = store.sessionDir
  sessionsRoot = store.sessionsRoot
  IDLE_WINDOW_MS = store.IDLE_WINDOW_MS
})

beforeEach(() => {
  // Destructive cleanup must be provably confined to this file's mkdtemp home.
  if (!sessionsRoot().startsWith(tmpdir())) throw new Error('refusing to clean a non-tmp home')
  rmSync(sessionsRoot(), { recursive: true, force: true })
})

type Seed = { ageMs?: number; analyzed?: boolean; events?: boolean; root?: string }

function seed(id: string, { ageMs = 0, analyzed = false, events = true, root = '/w' }: Seed): void {
  const dir = sessionDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id, root, explicit: false }))
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

describe('scanSessions', () => {
  test('reports the same id set, ordering and open/closed verdict as listSessions', () => {
    seed('scan-oldest', { ageMs: 5 * DAY, analyzed: true })
    seed('scan-middle', { ageMs: 2 * DAY })
    seed('scan-open', {})

    const scan = scanSessions()
    const full = listSessions()

    expect(scan.map((s) => s.id)).toEqual(full.map((s) => s.id))
    expect(scan.map((s) => s.closed)).toEqual(full.map((s) => s.closed))
    expect(scan.map((s) => s.lastEventAt?.getTime() ?? null)).toEqual(
      full.map((s) => s.lastEventAt?.getTime() ?? null),
    )
  })

  test('analyzed is presence of the marker, matching listSessions', () => {
    seed('scan-done', { ageMs: DAY, analyzed: true })
    seed('scan-pending', { ageMs: DAY })

    const byId = new Map(scanSessions().map((s) => [s.id, s.analyzed]))
    expect(byId.get('scan-done')).toBe(true)
    expect(byId.get('scan-pending')).toBe(false)
    expect(listSessions().map((s) => s.analyzed !== null)).toEqual(
      listSessions().map((s) => byId.get(s.id)!),
    )
  })

  test('an unparseable marker still counts as analyzed — presence is the fact', () => {
    seed('scan-broken-marker', { ageMs: DAY })
    writeFileSync(join(sessionDir('scan-broken-marker'), '.analyzed'), '{ not json')
    expect(scanSessions()[0]?.analyzed).toBe(true)
  })

  test('a session with no events yet is neither closed nor dated', () => {
    seed('scan-no-events', { events: false })
    const [only] = scanSessions()
    expect(only?.lastEventAt).toBeNull()
    expect(only?.closed).toBe(false)
  })

  test('closed is decided by the idle window', () => {
    seed('scan-just-inside', { ageMs: IDLE_WINDOW_MS - 60_000 })
    seed('scan-just-outside', { ageMs: IDLE_WINDOW_MS + 60_000 })
    const byId = new Map(scanSessions().map((s) => [s.id, s.closed]))
    expect(byId.get('scan-just-inside')).toBe(false)
    expect(byId.get('scan-just-outside')).toBe(true)
  })

  test('a missing store directory scans to an empty list', () => {
    rmSync(sessionsRoot(), { recursive: true, force: true })
    expect(scanSessions()).toEqual([])
  })

  test('dotfiles in the store root are not sessions', () => {
    seed('scan-real', { ageMs: DAY })
    mkdirSync(sessionsRoot(), { recursive: true })
    writeFileSync(join(sessionsRoot(), '.analyzer.lock'), '{}')
    expect(scanSessions().map((s) => s.id)).toEqual(['scan-real'])
  })
})

describe('readMeta', () => {
  test('returns the parsed meta for one session', () => {
    seed('meta-one', { ageMs: DAY, root: '/workspace/alpha' })
    expect(readMeta('meta-one')?.root).toBe('/workspace/alpha')
  })

  test('missing or broken meta reads as null rather than throwing', () => {
    expect(readMeta('meta-absent')).toBeNull()
    mkdirSync(sessionDir('meta-broken'), { recursive: true })
    writeFileSync(join(sessionDir('meta-broken'), 'meta.json'), '{ not json')
    expect(readMeta('meta-broken')).toBeNull()
  })
})
