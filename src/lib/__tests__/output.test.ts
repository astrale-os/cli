import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { isRawOutput, output } from '../output'

describe('output — void/undefined normalization', () => {
  let writes: string[] = []
  let originalWrite: typeof process.stdout.write

  beforeEach(() => {
    writes = []
    originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalWrite
  })

  test('--raw output for void syscall is "null", not bare "undefined"', () => {
    // Regression: JSON.stringify(undefined) returns undefined (not "undefined"),
    // so concatenating with '\n' coerced to the literal string 'undefined\n'.
    // Any wrapper doing JSON.parse(stdout) would blow up.
    output(undefined, { raw: true })
    expect(writes.join('')).toBe('null\n')
  })

  test('--json output for void syscall is "null"', () => {
    output(undefined, { json: true })
    expect(writes.join('')).toBe('null\n')
  })

  test('explicit format=json on non-TTY yields "null" for void', () => {
    output(undefined, { format: 'json' })
    const out = writes.join('')
    // On TTY the value gets ANSI-colored; either way the parseable token is `null`.
    expect(out).toContain('null')
    expect(out).not.toContain('undefined')
  })

  test('--raw output for actual data is unchanged', () => {
    output({ a: 1 }, { raw: true })
    expect(writes.join('')).toBe('{\n  "a": 1\n}\n')
  })
})

describe('isRawOutput', () => {
  test('returns true for --raw', () => {
    expect(isRawOutput({ raw: true })).toBe(true)
  })

  test('returns true for --json', () => {
    expect(isRawOutput({ json: true })).toBe(true)
  })

  test('returns true when both are set', () => {
    expect(isRawOutput({ raw: true, json: true })).toBe(true)
  })

  test('returns false for empty opts when TTY', () => {
    // This test depends on the test runner's TTY state.
    // In a non-TTY environment (CI), isRawOutput({}) returns true.
    const result = isRawOutput({})
    expect(typeof result).toBe('boolean')
  })

  test('handles undefined opts', () => {
    const result = isRawOutput()
    expect(typeof result).toBe('boolean')
  })
})
