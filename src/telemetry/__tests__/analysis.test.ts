import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { TelemetryEvent } from '../types'

import { claudeCodeAdapter } from '../adapters/claude-code'
import { codexAdapter } from '../adapters/codex'
import { discoverAll } from '../adapters/index'
import { buildPrompt, clampLog } from '../analyze'
import { commandHead, extractSignals, hasSignals } from '../gate'

const ROOT = '/work/proj'
let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'astrale-harness-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function event(argv: string[], exitCode = 0, errorName?: string): TelemetryEvent {
  return {
    v: 1,
    ts: '',
    argv,
    exitCode,
    errorName,
    durationMs: 1,
    cwd: '/w',
    root: '/w',
    surface: 'cli',
  }
}

function transcript(path: string, body: string, mtime: Date): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
  utimesSync(path, mtime, mtime)
  return path
}

function rollout(day: string, cwd: string, mtime: Date, padding = 0): string {
  const meta = JSON.stringify({
    type: 'session_meta',
    payload: {
      base_instructions: 'x'.repeat(padding),
      session_id: `sid-${cwd}`,
      timestamp: mtime.toISOString(),
      cwd,
    },
  })
  return transcript(
    join(base, 'sessions', ...day.split('-'), `rollout-${cwd.replaceAll('/', '_')}.jsonl`),
    `${meta}\n{}\n`,
    mtime,
  )
}

describe('session analysis', () => {
  test('the free gate groups failures and retries by command head', () => {
    expect(commandHead(['domain', 'install', 'x', '--json'])).toBe('domain install')
    const signals = extractSignals([
      event(['call', '@x'], 1, 'KERNEL_ERROR'),
      event(['call', '@y'], 1, 'KERNEL_ERROR'),
      event(['status']),
      event(['status']),
      event(['status']),
    ])
    expect(signals.failures).toEqual([
      { command: 'call @x', count: 1, errorNames: ['KERNEL_ERROR'] },
      { command: 'call @y', count: 1, errorNames: ['KERNEL_ERROR'] },
    ])
    expect(signals.retries).toEqual([{ command: 'status', count: 3 }])
    expect(hasSignals(extractSignals([event(['status'])]))).toBe(false)
  })

  test('an oversized analyzer log keeps its head and tail', () => {
    expect(clampLog('short', 100)).toBe('short')
    const clamped = clampLog(`HEAD${'x'.repeat(10_000)}TAIL`, 1_000)
    expect(clamped).toStartWith('HEAD')
    expect(clamped).toEndWith('TAIL')
    expect(clamped.length).toBeLessThan(1_100)
  })

  test('filing creates issues through the Issues Project method in machine mode', () => {
    const signals = { eventCount: 0, failures: [], retries: [], harnessSessions: [] }
    const prompt = buildPrompt({ id: 's', root: '/w', signals, guides: new Map(), file: true })
    expect(prompt).toContain(
      'astrale --ci --no-prompt call "@$ASTRALE_ISSUES_PROJECT_ID::issues.astrale.ai:class.Project.method.createIssue"',
    )
    expect(buildPrompt({ id: 's', root: '/w', signals, guides: new Map(), file: false })).toContain(
      'Do NOT file any issues',
    )
  })
})

describe('harness transcript discovery', () => {
  const window = { start: new Date('2026-07-10T00:00:00Z'), end: new Date('2026-07-10T23:00:00Z') }

  test('Claude Code: transcripts of the root and its subdirectories that overlap the window', () => {
    const inWindow = new Date('2026-07-10T10:00:00Z')
    const projects = join(base, 'claude', 'projects')
    transcript(join(projects, '-work-proj', 'a.jsonl'), '{}\n', inWindow)
    transcript(join(projects, '-work-proj-api', 'b.jsonl'), '{}\n', inWindow)
    transcript(join(projects, '-work-other', 'c.jsonl'), '{}\n', inWindow)
    transcript(join(projects, '-work-proj', 'notes.txt'), '', inWindow)

    const found = claudeCodeAdapter(join(base, 'claude')).discover(ROOT, window)
    expect(found.map((session) => session.sessionId).sort()).toEqual(['a', 'b'])
    expect(claudeCodeAdapter(join(base, 'absent')).discover(ROOT, window)).toEqual([])
  })

  test('Codex: rollouts whose first line names the root, across date shards and large headers', () => {
    const inWindow = new Date('2026-07-10T22:30:00Z')
    rollout('2026-07-10', ROOT, inWindow, 80 * 1024)
    rollout('2026-07-11', `${ROOT}/api`, inWindow)
    rollout('2026-07-10', '/work/other', inWindow)
    rollout('2026-07-09', `${ROOT}/old`, new Date('2026-07-09T08:00:00Z'))
    transcript(
      join(base, 'sessions', '2026', '07', '10', 'rollout-broken.jsonl'),
      'not json\n',
      inWindow,
    )

    const found = codexAdapter(base).discover(ROOT, window)
    expect(found.map((session) => session.cwd).sort()).toEqual([ROOT, `${ROOT}/api`])
  })

  test('all adapters merge newest first and a failing adapter contributes nothing', () => {
    const adapter = (name: string, endedAt: string) => ({
      name,
      readingGuide: '',
      discover: () => [{ harness: name, transcriptPath: name, endedAt, sizeBytes: 0 }],
    })
    const broken = {
      name: 'broken',
      readingGuide: '',
      discover: () => {
        throw new Error('x')
      },
    }

    const found = discoverAll(
      [adapter('old', '2026-07-01T00:00:00Z'), broken, adapter('new', '2026-07-02T00:00:00Z')],
      ROOT,
      window,
    )
    expect(found.map((session) => session.harness)).toEqual(['new', 'old'])
  })
})
