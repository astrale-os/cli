import { describe, expect, test } from 'bun:test'

import { shouldShowDomainSelectionIndicator } from './tree'

describe('workspace domain selection indicator', () => {
  test.each([
    { active: true, closed: true, selected: 'class.User', expected: true },
    { active: true, closed: false, selected: 'class.User', expected: false },
    { active: true, closed: true, selected: undefined, expected: false },
    { active: false, closed: true, selected: 'class.User', expected: false },
  ])('returns $expected for active=$active, closed=$closed, selected=$selected', (state) => {
    expect(shouldShowDomainSelectionIndicator(state)).toBe(state.expected)
  })
})
