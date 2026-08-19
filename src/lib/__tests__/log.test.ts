import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { log } from '../log'

describe('log diagnostics', () => {
  let stdout: string[]
  let stderr: string[]
  let originalLog: typeof console.log
  let originalError: typeof console.error

  beforeEach(() => {
    stdout = []
    stderr = []
    originalLog = console.log
    originalError = console.error
    console.log = mock((...values: unknown[]) => stdout.push(values.map(String).join(' ')))
    console.error = mock((...values: unknown[]) => stderr.push(values.map(String).join(' ')))
  })

  afterEach(() => {
    console.log = originalLog
    console.error = originalError
  })

  test('warnings use stderr so machine-readable stdout remains one value', () => {
    log.warn('identity override consented')

    expect(stdout).toEqual([])
    expect(stderr.join('\n')).toContain('identity override consented')
  })
})
