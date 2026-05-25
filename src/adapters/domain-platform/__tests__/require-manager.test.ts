import { afterEach, describe, expect, mock, test } from 'bun:test'
import * as childProcess from 'node:child_process'

import { AstraleError } from '../../../errors'
import { requireAstraleManager } from '../cloudflare-helpers'

/**
 * `requireAstraleManager` asserts the manager is up and throws otherwise —
 * it no longer auto-starts it (auto-start silently forced docker-mode + a
 * token-gated image rebuild). Its only signal is `isAstraleRunning()`,
 * which shells out to `astrale status` via `spawnSync` and parses the JSON.
 * We mock that seam to drive the three outcomes.
 */
const realChildProcess = { ...childProcess }

/** Replace `node:child_process.spawnSync` with a canned `astrale status`. */
function stubStatus(result: { status: number; stdout?: string }): void {
  mock.module('node:child_process', () => ({
    ...realChildProcess,
    spawnSync: () => ({ status: result.status, stdout: result.stdout ?? '', stderr: '' }),
  }))
}

/** Run `fn`, assert it threw `MANAGER_NOT_RUNNING` (the message has no such substring, so `.toThrow` can't check the code). */
function expectManagerNotRunning(fn: () => void): void {
  try {
    fn()
    throw new Error('expected requireAstraleManager to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(AstraleError)
    expect((e as AstraleError).code).toBe('MANAGER_NOT_RUNNING')
  }
}

afterEach(() => {
  // Restore the real module so other suites aren't affected.
  mock.module('node:child_process', () => realChildProcess)
})

describe('requireAstraleManager', () => {
  test('manager up → no throw', () => {
    stubStatus({ status: 0, stdout: '{"manager":{"running":true}}' })
    expect(() => requireAstraleManager({ quiet: true })).not.toThrow()
  })

  test('manager down → throws MANAGER_NOT_RUNNING', () => {
    stubStatus({ status: 0, stdout: '{"manager":{"running":false}}' })
    expectManagerNotRunning(() => requireAstraleManager({ quiet: true }))
  })

  test('status command fails → throws MANAGER_NOT_RUNNING', () => {
    stubStatus({ status: 1 })
    expectManagerNotRunning(() => requireAstraleManager({ quiet: true }))
  })

  test('kernelPreset is woven into the message', () => {
    stubStatus({ status: 0, stdout: '{"manager":{"running":false}}' })
    expect(() =>
      requireAstraleManager({ quiet: true, kernelPreset: 'local:manager:inprocess' }),
    ).toThrow('local:manager:inprocess')
  })
})
