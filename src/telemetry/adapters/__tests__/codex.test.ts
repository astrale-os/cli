import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { codexAdapter } from '../codex'

const ROOT = '/work/proj'
const WINDOW = {
  start: new Date('2026-07-10T00:00:00.000Z'),
  end: new Date('2026-07-10T23:59:59.000Z'),
}
const IN_DAY = ['2026', '07', '10']

let base: string

function meta(cwd: string, timestamp = '2026-07-10T10:00:00.000Z'): string {
  return JSON.stringify({
    type: 'session_meta',
    payload: { session_id: `sid-${cwd}`, timestamp, cwd, cli_version: '1.2.3' },
  })
}

function rollout(
  day: string[],
  name: string,
  firstLine: string,
  mtime = new Date('2026-07-10T10:05:00.000Z'),
): string {
  const dir = join(base, 'sessions', ...day)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `rollout-${name}.jsonl`)
  writeFileSync(p, `${firstLine}\n{"type":"response_item"}\n{"type":"event_msg"}\n`)
  utimesSync(p, mtime, mtime)
  return p
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'codex-adapter-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('codexAdapter', () => {
  test('detect follows the sessions dir', () => {
    expect(codexAdapter(base).detect()).toBe(false)
    mkdirSync(join(base, 'sessions'), { recursive: true })
    expect(codexAdapter(base).detect()).toBe(true)
  })

  test('cwd filtering: exact root and subdir included, unrelated excluded', async () => {
    rollout(IN_DAY, 'exact', meta(ROOT))
    rollout(IN_DAY, 'sub', meta(`${ROOT}/packages/app`))
    rollout(IN_DAY, 'sibling', meta('/work/project-x'))
    rollout(IN_DAY, 'elsewhere', meta('/somewhere/else'))

    const sessions = await codexAdapter(base).discover(ROOT, WINDOW)
    const cwds = sessions.map((s) => s.cwd).sort()
    expect(cwds).toEqual([ROOT, `${ROOT}/packages/app`])
    for (const s of sessions) {
      expect(s.harness).toBe('codex')
      expect(s.sessionId).toBe(`sid-${s.cwd}`)
      expect(s.startedAt).toBe('2026-07-10T10:00:00.000Z')
      expect(typeof s.endedAt).toBe('string')
      expect(s.sizeBytes).toBeGreaterThan(0)
    }
  })

  test('window filtering: rollout with mtime before the window is excluded', async () => {
    rollout(IN_DAY, 'in', meta(ROOT))
    rollout(
      IN_DAY,
      'stale',
      meta(ROOT, '2026-07-08T10:00:00.000Z'),
      new Date('2026-07-08T10:00:00.000Z'),
    )

    const ids = (await codexAdapter(base).discover(ROOT, WINDOW)).map((s) => s.sessionId)
    // both share the same synthetic session_id; assert exactly one survived
    expect(ids.length).toBe(1)
  })

  test('date-shard pruning skips days outside the window', async () => {
    rollout(['2026', '01', '01'], 'jan', meta(ROOT), new Date('2026-01-01T10:00:00.000Z'))
    const ids = await codexAdapter(base).discover(ROOT, WINDOW)
    expect(ids).toEqual([])
  })

  test('a corrupt first line is skipped without throwing', async () => {
    rollout(IN_DAY, 'good', meta(ROOT))
    rollout(IN_DAY, 'corrupt', '{ this is not json ]]]')

    const sessions = await codexAdapter(base).discover(ROOT, WINDOW)
    expect(sessions.length).toBe(1)
    expect(sessions[0]?.cwd).toBe(ROOT)
  })

  test('never throws and returns [] when the sessions dir is missing', async () => {
    expect(await codexAdapter(join(base, 'absent')).discover(ROOT, WINDOW)).toEqual([])
  })
})

describe('codexAdapter large session_meta', () => {
  test('first line larger than one read chunk still parses (real rollouts embed base_instructions)', async () => {
    // Padding before cwd pushes it past the first 64 KB chunk boundary.
    const huge = JSON.stringify({
      type: 'session_meta',
      payload: {
        base_instructions: { text: 'x'.repeat(80 * 1024) },
        session_id: 'sid-huge',
        timestamp: '2026-07-10T10:00:00.000Z',
        cwd: ROOT,
        cli_version: '1.2.3',
      },
    })
    rollout(IN_DAY, 'huge', huge)
    const sessions = await codexAdapter(base).discover(ROOT, WINDOW)
    expect(sessions.map((s) => s.sessionId)).toEqual(['sid-huge'])
  })
})
