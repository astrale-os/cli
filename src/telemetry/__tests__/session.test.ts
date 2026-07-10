import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ResolvedSession } from '../session'
import type { SessionMeta } from '../types'

/** Seed an ambient session on disk with a chosen id + last-activity age. */
function seedAmbient(id: string, root: string, ageMs: number): void {
  mkdirSync(sessionDir(id), { recursive: true })
  const meta: SessionMeta = { id, root, explicit: false, createdAt: new Date().toISOString() }
  writeFileSync(metaPath(id), JSON.stringify(meta))
  writeFileSync(eventsPath(id), '{}\n')
  const when = new Date(Date.now() - ageMs)
  utimesSync(eventsPath(id), when, when)
}

// Set ASTRALE_HOME before the store/paths singleton is first evaluated (below,
// via dynamic import). All on-disk access goes through the store helpers so it
// stays consistent whichever home the singleton captured.
process.env.ASTRALE_HOME = mkdtempSync(join(tmpdir(), 'astrale-tele-session-'))

let resolveSession: (cwd: string) => ResolvedSession
let ensureSession: (cwd: string) => ResolvedSession
let eventsPath: (id: string) => string
let metaPath: (id: string) => string
let sessionDir: (id: string) => string
let sessionsRoot: () => string
let IDLE_WINDOW_MS: number

let work: string

beforeAll(async () => {
  const session = await import('../session')
  const store = await import('../store')
  resolveSession = session.resolveSession
  ensureSession = session.ensureSession
  eventsPath = store.eventsPath
  metaPath = store.metaPath
  sessionDir = store.sessionDir
  sessionsRoot = store.sessionsRoot
  IDLE_WINDOW_MS = store.IDLE_WINDOW_MS
})

beforeEach(() => {
  rmSync(sessionsRoot(), { recursive: true, force: true })
  delete process.env.ASTRALE_SESSION
  work = mkdtempSync(join(tmpdir(), 'astrale-tele-work-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('resolveSession — ambient', () => {
  test('reuses an open ambient session bucketed to the same root', () => {
    // An old-stamp id proves reuse: a fresh mint would carry the current minute.
    const existing = 'amb-deadbeef-200001010000'
    seedAmbient(existing, work, 5 * 60_000)

    const r = resolveSession(work)

    expect(r).toEqual({ id: existing, root: work, explicit: false })
  })

  test('mints a fresh session once the previous one is idle', () => {
    const existing = 'amb-deadbeef-200001010000'
    seedAmbient(existing, work, IDLE_WINDOW_MS + 60_000)

    const r = resolveSession(work)

    expect(r.id).not.toBe(existing)
    expect(r.explicit).toBe(false)
    expect(r.id).toMatch(/^amb-[0-9a-f]{8}-\d{12}$/)
  })

  test('does not reuse a session bucketed to a different root', () => {
    const existing = 'amb-deadbeef-200001010000'
    seedAmbient(existing, work, 5 * 60_000)

    const other = mkdtempSync(join(tmpdir(), 'astrale-tele-other-'))
    try {
      expect(resolveSession(other).id).not.toBe(existing)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  test('ensureSession creates then reuses one session across calls', () => {
    const first = ensureSession(work)
    const second = ensureSession(work)
    expect(second.id).toBe(first.id)
    expect(first.id).toMatch(/^amb-[0-9a-f]{8}-\d{12}$/)
  })
})

describe('resolveSession — root bucketing', () => {
  test('buckets by the nearest .git ancestor, not cwd', () => {
    mkdirSync(join(work, '.git'), { recursive: true })
    const deep = join(work, 'sub', 'deep')
    mkdirSync(deep, { recursive: true })

    expect(resolveSession(deep).root).toBe(work)
  })

  test('falls back to cwd when there is no git root', () => {
    expect(resolveSession(work).root).toBe(work)
  })
})

describe('resolveSession — explicit ASTRALE_SESSION', () => {
  test('honors an explicit id, sanitizing unsafe chars and capping at 64', () => {
    process.env.ASTRALE_SESSION = 'my/weird:sess!!'
    const r = resolveSession(work)
    expect(r).toEqual({ id: 'myweirdsess', root: work, explicit: true })

    process.env.ASTRALE_SESSION = 'a'.repeat(80)
    expect(resolveSession(work).id).toBe('a'.repeat(64))
  })

  test('falls through to ambient when the id is empty after sanitizing', () => {
    process.env.ASTRALE_SESSION = '///'
    const r = resolveSession(work)
    expect(r.explicit).toBe(false)
    expect(r.id).toMatch(/^amb-/)
  })
})

describe('ensureSession', () => {
  test('creates the session dir and a readable meta.json once', () => {
    const r = ensureSession(work)

    expect(existsSync(metaPath(r.id))).toBe(true)
    const meta = JSON.parse(readFileSync(metaPath(r.id), 'utf-8')) as SessionMeta
    expect(meta.id).toBe(r.id)
    expect(meta.root).toBe(work)
    expect(meta.explicit).toBe(false)
    expect(typeof meta.createdAt).toBe('string')
  })
})
