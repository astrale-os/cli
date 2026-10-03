import { expect, test } from 'bun:test'

import { contextLevel, contextPercent, formatTokens } from './context-ring'

test('the ring stays calm with room left and turns red as the window fills', () => {
  expect(contextLevel(undefined)).toBe('unknown')
  expect(contextLevel({ used: 20_000, size: 200_000 })).toBe('roomy')
  expect(contextLevel({ used: 130_000, size: 200_000 })).toBe('filling')
  expect(contextLevel({ used: 190_000, size: 200_000 })).toBe('full')
  // an agent that overshoots its own window is still just full
  expect(contextLevel({ used: 260_000, size: 200_000 })).toBe('full')
})

test('says how full the window is in whole numbers, never 0% for a window in use', () => {
  expect(contextPercent({ used: 0, size: 200_000 })).toBe('0%')
  expect(contextPercent({ used: 500, size: 200_000 })).toBe('<1%')
  expect(contextPercent({ used: 84_321, size: 200_000 })).toBe('42%')
  expect(contextPercent({ used: 300_000, size: 200_000 })).toBe('100%')
})

test('counts tokens at a glance', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_400)).toBe('12.4k')
  expect(formatTokens(84_000)).toBe('84k')
  expect(formatTokens(200_000)).toBe('200k')
  expect(formatTokens(1_000_000)).toBe('1M')
})
