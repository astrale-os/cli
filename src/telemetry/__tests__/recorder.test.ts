import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Finalizer } from '../recorder'
import type { SessionInfo } from '../store'
import type { TelemetryEvent } from '../types'

// ASTRALE_HOME must be set before the store/paths singleton is first imported.
process.env.ASTRALE_HOME = mkdtempSync(join(tmpdir(), 'astrale-tele-recorder-'))

let beginInvocation: (argv: string[]) => Finalizer
let eventsPath: (id: string) => string
let listSessions: () => SessionInfo[]
let sessionsRoot: () => string
let configPath: string

const SESSION = 'rec-test'

let work: string
let cwd0: string

beforeAll(async () => {
  const recorder = await import('../recorder')
  const store = await import('../store')
  beginInvocation = recorder.beginInvocation
  eventsPath = store.eventsPath
  listSessions = store.listSessions
  sessionsRoot = store.sessionsRoot
  configPath = join(process.env.ASTRALE_HOME!, 'config.json')
})

beforeEach(() => {
  // Destructive cleanup must be provably confined to this file's mkdtemp home.
  if (!sessionsRoot().startsWith(tmpdir())) throw new Error('refusing to clean a non-tmp home')
  rmSync(sessionsRoot(), { recursive: true, force: true })
  rmSync(configPath, { force: true })
  delete process.env.ASTRALE_TELEMETRY
  process.env.ASTRALE_SESSION = SESSION
  work = mkdtempSync(join(tmpdir(), 'astrale-tele-recwork-'))
  cwd0 = process.cwd()
  process.chdir(work)
})

afterEach(() => {
  process.chdir(cwd0)
  rmSync(work, { recursive: true, force: true })
})

function readEvents(id: string): TelemetryEvent[] {
  return readFileSync(eventsPath(id), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TelemetryEvent)
}

describe('beginInvocation', () => {
  test('appends one valid, parseable event with redacted argv', () => {
    const cwd = process.cwd()
    const finalize = beginInvocation(['node', 'astrale', 'get', '--token', 'abc', 'x'])
    finalize(0)

    const events = readEvents(SESSION)
    expect(events).toHaveLength(1)
    const [e] = events
    expect(e.v).toBe(1)
    expect(e.surface).toBe('cli')
    expect(e.exitCode).toBe(0)
    expect(e.argv).toEqual(['get', '--token', '<redacted>', 'x'])
    expect(e.cwd).toBe(cwd)
    expect(e.root).toBe(cwd)
    expect(typeof e.ts).toBe('string')
    expect(typeof e.durationMs).toBe('number')
    expect('errorName' in e).toBe(false)
  })

  test('records exitCode and errorName on failure', () => {
    beginInvocation(['node', 'astrale', 'call', 'foo'])(1, 'AuthError')
    const [e] = readEvents(SESSION)
    expect(e.exitCode).toBe(1)
    expect(e.errorName).toBe('AuthError')
  })

  test('appends a second line on a second invocation', () => {
    beginInvocation(['node', 'astrale', 'query'])(0)
    beginInvocation(['node', 'astrale', 'whoami'])(0)
    expect(readEvents(SESSION)).toHaveLength(2)
  })

  test('writes nothing for help/version-only invocations', () => {
    beginInvocation(['node', 'astrale', '--help'])(0)
    beginInvocation(['node', 'astrale', '--version'])(0)
    beginInvocation(['node', 'astrale'])(0)
    expect(listSessions()).toHaveLength(0)
  })

  test('writes nothing when disabled via ASTRALE_TELEMETRY', () => {
    process.env.ASTRALE_TELEMETRY = '0'
    beginInvocation(['node', 'astrale', 'get', 'x'])(0)
    expect(listSessions()).toHaveLength(0)
    expect(existsSync(eventsPath(SESSION))).toBe(false)
  })

  test('writes nothing when disabled via config telemetry.enabled=false', () => {
    writeFileSync(configPath, JSON.stringify({ telemetry: { enabled: false } }))
    beginInvocation(['node', 'astrale', 'get', 'x'])(0)
    expect(listSessions()).toHaveLength(0)
  })
})
