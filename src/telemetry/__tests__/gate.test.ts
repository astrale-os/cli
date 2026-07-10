import { describe, expect, test } from 'bun:test'

import type { TelemetryEvent } from '../types'

import { commandHead, extractSignals, hasSignals } from '../gate'

function ev(argv: string[], exitCode: number, errorName?: string): TelemetryEvent {
  return {
    v: 1,
    ts: '2026-07-10T10:00:00.000Z',
    argv,
    exitCode,
    durationMs: 10,
    errorName,
    cwd: '/w',
    root: '/w',
    surface: 'cli',
  }
}

describe('commandHead', () => {
  test('keeps up to two leading command tokens, stops at flags/values', () => {
    expect(commandHead(['get', '/path', '-i', 'x'])).toBe('get /path')
    expect(commandHead(['domain', 'install', './foo'])).toBe('domain install')
    expect(commandHead(['status'])).toBe('status')
    expect(commandHead(['--help'])).toBe('(bare)')
    expect(commandHead(['call', 'k=v'])).toBe('call')
  })
})

describe('extractSignals / hasSignals', () => {
  test('failures grouped by command with error names', () => {
    const s = extractSignals([
      ev(['domain', 'install'], 1, 'AUTH_ERROR'),
      ev(['domain', 'install'], 1, 'AUTH_ERROR'),
      ev(['status'], 0),
    ])
    expect(s.failures).toEqual([
      { command: 'domain install', count: 2, errorNames: ['AUTH_ERROR'] },
    ])
    expect(s.retries).toEqual([])
    expect(hasSignals(s)).toBe(true)
  })

  test('3+ runs of one command is a retry smell even when green', () => {
    const s = extractSignals([ev(['get', '/a'], 0), ev(['get', '/a'], 0), ev(['get', '/a'], 0)])
    expect(s.retries).toEqual([{ command: 'get /a', count: 3 }])
    expect(hasSignals(s)).toBe(true)
  })

  test('quiet session has no signals until a transcript is attached', () => {
    const s = extractSignals([ev(['status'], 0), ev(['ls', '/'], 0)])
    expect(hasSignals(s)).toBe(false)
    s.harnessSessions = [
      {
        harness: 'claude-code',
        transcriptPath: '/t.jsonl',
        sizeBytes: 1,
      },
    ]
    expect(hasSignals(s)).toBe(true)
  })
})
