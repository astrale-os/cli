import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { claudeCodeAdapter } from '../claude-code'

const ROOT = '/tmp/fake/proj'
const MUNGED = '-tmp-fake-proj'

let base: string

function project(dir: string, file: string, mtime: Date): string {
  const projPath = join(base, 'projects', dir)
  mkdirSync(projPath, { recursive: true })
  const p = join(projPath, file)
  writeFileSync(p, '{"type":"user"}\n')
  utimesSync(p, mtime, mtime)
  return p
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cc-adapter-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('claudeCodeAdapter', () => {
  test('detect is false without a projects dir, true with one', () => {
    expect(claudeCodeAdapter(base).detect()).toBe(false)
    mkdirSync(join(base, 'projects'), { recursive: true })
    expect(claudeCodeAdapter(base).detect()).toBe(true)
  })

  test('matches the exact munged dir and subdir-prefixed dirs, excludes unrelated', async () => {
    const now = new Date()
    const wide = {
      start: new Date(now.getTime() - 2 * 3600_000),
      end: new Date(now.getTime() + 2 * 3600_000),
    }
    project(MUNGED, 'exact.jsonl', now)
    project(`${MUNGED}-sub-deeper`, 'child.jsonl', now)
    project('-other-unrelated-path', 'nope.jsonl', now)

    const sessions = await claudeCodeAdapter(base).discover(ROOT, wide)
    const ids = sessions.map((s) => s.sessionId).sort()
    expect(ids).toEqual(['child', 'exact'])
    for (const s of sessions) {
      expect(s.harness).toBe('claude-code')
      expect(s.sizeBytes).toBeGreaterThan(0)
      expect(typeof s.endedAt).toBe('string')
      expect(typeof s.startedAt).toBe('string')
    }
  })

  test('window filtering: excludes a transcript whose span sits entirely after the window', async () => {
    const t = Date.now()
    const window = { start: new Date(t - 2 * 3600_000), end: new Date(t - 3600_000) }
    project(MUNGED, 'inside.jsonl', new Date(t - 90 * 60_000))
    project(MUNGED, 'after.jsonl', new Date(t - 30 * 60_000))

    const ids = (await claudeCodeAdapter(base).discover(ROOT, window)).map((s) => s.sessionId)
    expect(ids).toContain('inside')
    expect(ids).not.toContain('after')
  })

  test('only *.jsonl files are considered', async () => {
    const now = new Date()
    const wide = {
      start: new Date(now.getTime() - 3600_000),
      end: new Date(now.getTime() + 3600_000),
    }
    project(MUNGED, 'keep.jsonl', now)
    project(MUNGED, 'ignore.txt', now)

    const ids = (await claudeCodeAdapter(base).discover(ROOT, wide)).map((s) => s.sessionId)
    expect(ids).toEqual(['keep'])
  })

  test('never throws and returns [] when the projects dir is missing', async () => {
    const now = new Date()
    const sessions = await claudeCodeAdapter(join(base, 'does-not-exist')).discover(ROOT, {
      start: new Date(now.getTime() - 3600_000),
      end: now,
    })
    expect(sessions).toEqual([])
  })
})
