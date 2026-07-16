import { expect, test } from 'bun:test'

import { parseStudioNumericSetting } from './settings-values'

test('accepts bounded integer Studio timing settings', () => {
  expect(parseStudioNumericSetting('instancePollMs', '1000')).toBe(1000)
  expect(parseStudioNumericSetting('instancePollMs', 3_600_000)).toBe(3_600_000)
})

test('rejects blank, fractional, non-finite, and out-of-range Studio timing settings', () => {
  expect(parseStudioNumericSetting('instancePollMs', '')).toBeNull()
  expect(parseStudioNumericSetting('instancePollMs', 999)).toBeNull()
  expect(parseStudioNumericSetting('instancePollMs', 1_000.5)).toBeNull()
  expect(parseStudioNumericSetting('instancePollMs', Number.POSITIVE_INFINITY)).toBeNull()
  expect(parseStudioNumericSetting('instancePollMs', 3_600_001)).toBeNull()
  expect(parseStudioNumericSetting('instancePollMs', [1_000])).toBeNull()
  expect(parseStudioNumericSetting('instancePollMs', { valueOf: () => 1_000 })).toBeNull()
})
