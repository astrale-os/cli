import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { claudeCodeAdapter } from '../claude-code'
import { codexAdapter } from '../codex'
import { defaultAdapters, discoverAll } from '../index'

const ROOT = '/work/proj'
const WINDOW = {
  start: new Date('2026-07-01T00:00:00.000Z'),
  end: new Date(Date.now() + 86_400_000),
}

let ccBase: string
let cxBase: string

function seedClaude(mtime: Date): void {
  const dir = join(ccBase, 'projects', '-work-proj')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'cc-session.jsonl')
  writeFileSync(p, '{"type":"user"}\n')
  utimesSync(p, mtime, mtime)
}

function seedCodex(mtime: Date): void {
  const dir = join(cxBase, 'sessions', '2026', '07', '10')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'rollout-x.jsonl')
  const line = JSON.stringify({
    type: 'session_meta',
    payload: { session_id: 'cx-session', timestamp: '2026-07-10T10:00:00.000Z', cwd: ROOT },
  })
  writeFileSync(p, `${line}\n`)
  utimesSync(p, mtime, mtime)
}

beforeEach(() => {
  ccBase = mkdtempSync(join(tmpdir(), 'cc-base-'))
  cxBase = mkdtempSync(join(tmpdir(), 'cx-base-'))
})
afterEach(() => {
  rmSync(ccBase, { recursive: true, force: true })
  rmSync(cxBase, { recursive: true, force: true })
})

describe('discoverAll', () => {
  test('defaultAdapters exposes both harnesses', () => {
    expect(
      defaultAdapters()
        .map((a) => a.name)
        .sort(),
    ).toEqual(['claude-code', 'codex'])
  })

  test('merges detected adapters and sorts by endedAt descending', async () => {
    seedClaude(new Date('2026-07-10T09:00:00.000Z'))
    seedCodex(new Date('2026-07-10T11:00:00.000Z'))

    const sessions = await discoverAll(
      [claudeCodeAdapter(ccBase), codexAdapter(cxBase)],
      ROOT,
      WINDOW,
    )
    expect(sessions.map((s) => s.harness)).toEqual(['codex', 'claude-code'])
  })

  test('never throws when a base dir is missing; returns only the detected harness', async () => {
    seedClaude(new Date('2026-07-10T09:00:00.000Z'))

    const sessions = await discoverAll(
      [claudeCodeAdapter(ccBase), codexAdapter(join(cxBase, 'absent'))],
      ROOT,
      WINDOW,
    )
    expect(sessions.map((s) => s.harness)).toEqual(['claude-code'])
  })

  test('returns [] when nothing is detected', async () => {
    const sessions = await discoverAll(
      [claudeCodeAdapter(join(ccBase, 'absent')), codexAdapter(join(cxBase, 'absent'))],
      ROOT,
      WINDOW,
    )
    expect(sessions).toEqual([])
  })
})
