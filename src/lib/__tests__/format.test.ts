import { describe, expect, test } from 'bun:test'

import { formatElapsed } from '../format'

describe('formatElapsed', () => {
  test('formats milliseconds under 1s', () => {
    expect(formatElapsed(50)).toBe('50ms')
    expect(formatElapsed(999)).toBe('999ms')
    expect(formatElapsed(0)).toBe('0ms')
  })

  test('rounds fractional ms', () => {
    expect(formatElapsed(50.7)).toBe('51ms')
    expect(formatElapsed(0.4)).toBe('0ms')
  })

  test('formats seconds at 1000ms+', () => {
    expect(formatElapsed(1000)).toBe('1.00s')
    expect(formatElapsed(1500)).toBe('1.50s')
    expect(formatElapsed(12345)).toBe('12.35s')
  })
})
