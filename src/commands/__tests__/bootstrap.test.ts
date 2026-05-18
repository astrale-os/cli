import { ConnectionError, NotFoundError } from '@astrale-os/kernel-client'
import { describe, expect, test } from 'bun:test'

import { classifyGetResult, deriveState } from '../bootstrap'

describe('bootstrap — classifyGetResult', () => {
  test('NotFoundError means the domain is absent (install)', () => {
    expect(classifyGetResult(Object.create(NotFoundError.prototype))).toBe('absent')
  })

  test('ConnectionError is a fatal-connection (manager died)', () => {
    expect(classifyGetResult(Object.create(ConnectionError.prototype))).toBe('fatal-connection')
  })

  test('any other error is fatal — never treated as absent', () => {
    expect(classifyGetResult(new Error('permission denied'))).toBe('fatal')
    expect(classifyGetResult({ name: 'AuthenticationError' })).toBe('fatal')
    expect(classifyGetResult(undefined)).toBe('fatal')
  })
})

describe('bootstrap — deriveState', () => {
  test('not probed → installed (distribution path)', () => {
    expect(deriveState(false, false)).toBe('installed')
    expect(deriveState(false, true)).toBe('installed')
  })

  test('probed and up → installed', () => {
    expect(deriveState(true, true)).toBe('installed')
  })

  test('probed and down → installed/worker-down', () => {
    expect(deriveState(true, false)).toBe('installed/worker-down')
  })
})
