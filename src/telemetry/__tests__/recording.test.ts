import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { TelemetryEvent } from '../types'

import { beginInvocation } from '../recorder'
import { redactArgv } from '../redact'
import { ensureSession, resolveSession } from '../session'
import { eventsPath, IDLE_WINDOW_MS, listSessions } from '../store'
import { seedSession, useTelemetryHome } from './fixture'

const telemetry = useTelemetryHome()

function recordedEvents(id: string): TelemetryEvent[] {
  return readFileSync(eventsPath(id), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelemetryEvent)
}

describe('invocation recording', () => {
  test('appends one redacted event per invocation to the session', () => {
    process.env.ASTRALE_SESSION = 'rec'
    beginInvocation(['bun', 'astrale', 'call', '@x', '--token', 'secret'])(0)
    beginInvocation(['bun', 'astrale', 'query', '--json'])(1, 'KERNEL_ERROR')

    const [first, second] = recordedEvents('rec')
    expect(first).toMatchObject({
      v: 1,
      argv: ['call', '@x', '--token', '<redacted>'],
      exitCode: 0,
    })
    expect(second).toMatchObject({
      argv: ['query', '--json'],
      exitCode: 1,
      errorName: 'KERNEL_ERROR',
    })
  })

  test('records nothing for help or version, or when disabled by environment or config', () => {
    process.env.ASTRALE_SESSION = 'rec'
    beginInvocation(['bun', 'astrale', '--help'])(0)
    beginInvocation(['bun', 'astrale'])(0)
    process.env.ASTRALE_TELEMETRY = 'off'
    beginInvocation(['bun', 'astrale', 'status'])(0)
    delete process.env.ASTRALE_TELEMETRY
    telemetry.configure({ enabled: false })
    beginInvocation(['bun', 'astrale', 'status'])(0)

    expect(listSessions()).toEqual([])
  })

  test('redacts secret flags, inline secrets and secret-shaped values, then bounds the argv', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij'
    expect(
      redactArgv([
        '--API-KEY',
        'k',
        '--client-secret=s',
        'call',
        jwt,
        'sk-abcdefghijklmnop1234',
        '/a/b',
      ]),
    ).toEqual([
      '--API-KEY',
      '<redacted>',
      '--client-secret=<redacted>',
      'call',
      '<redacted>',
      '<redacted>',
      '/a/b',
    ])
    expect(redactArgv(['--token'])).toEqual(['--token'])
    expect(redactArgv(['x'.repeat(300)])[0]).toHaveLength(201)
    expect(redactArgv(Array.from({ length: 45 }, () => 'a')).at(-1)).toBe('…+5')
  })
})

describe('session identity', () => {
  test('reuses the open, unanalyzed ambient session of the same root only', () => {
    const root = mkdtempSync(join(tmpdir(), 'astrale-telemetry-root-'))
    try {
      seedSession('open', { root })
      expect(resolveSession(root).id).toBe('open')

      seedSession('open', { root, ageMs: IDLE_WINDOW_MS + 1_000 })
      expect(resolveSession(root).id).toStartWith('amb-')
      seedSession('open', { root, analyzed: 'reported' })
      expect(resolveSession(root).id).toStartWith('amb-')
      seedSession('other', { root: '/elsewhere' })
      expect(resolveSession(root).id).not.toBe('other')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('buckets by the nearest git root and honours a sanitized ASTRALE_SESSION', () => {
    const root = mkdtempSync(join(tmpdir(), 'astrale-telemetry-git-'))
    try {
      mkdirSync(join(root, '.git'))
      mkdirSync(join(root, 'nested', 'dir'), { recursive: true })
      const ambient = ensureSession(join(root, 'nested', 'dir'))
      expect(ambient).toMatchObject({ root, explicit: false })
      expect(ensureSession(root).id).toBe(ambient.id)

      process.env.ASTRALE_SESSION = `a/b c${'x'.repeat(80)}`
      expect(resolveSession(root)).toMatchObject({ id: `abc${'x'.repeat(61)}`, explicit: true })
      process.env.ASTRALE_SESSION = '///'
      expect(resolveSession(root).explicit).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
