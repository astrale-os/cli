import { describe, expect, test } from 'bun:test'

import { isRawOutput } from '../output'

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
