import { expect, test } from 'bun:test'

import { formatElapsed } from '../terminal/format'

test('formatElapsed rounds to milliseconds under one second, then to centiseconds', () => {
  for (const [ms, shown] of [
    [0, '0ms'],
    [50.7, '51ms'],
    [999, '999ms'],
    [1000, '1.00s'],
    [12345, '12.35s'],
  ] as const) {
    expect(formatElapsed(ms)).toBe(shown)
  }
})
