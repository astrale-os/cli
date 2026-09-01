import { describe, expect, test } from 'bun:test'

import { shouldShowDomainSelectionIndicator } from './tree'

describe('workspace domain selection indicator', () => {
  test.each([
    { holdsSelection: true, closed: true, selected: 'class.User', expected: true },
    { holdsSelection: true, closed: false, selected: 'class.User', expected: false },
    { holdsSelection: true, closed: true, selected: undefined, expected: false },
    { holdsSelection: false, closed: true, selected: 'class.User', expected: false },
  ])(
    'returns $expected for holdsSelection=$holdsSelection, closed=$closed, selected=$selected',
    (state) => {
      expect(shouldShowDomainSelectionIndicator(state)).toBe(state.expected)
    },
  )
})
