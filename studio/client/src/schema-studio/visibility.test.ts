import { expect, test } from 'bun:test'

import { toggleVisibilityRef, VISIBILITY_DEFAULT } from './visibility'

test('visibility toggles one persisted ref without mutating the current query value', () => {
  const hidden = toggleVisibilityRef(VISIBILITY_DEFAULT, 'domain.remote.example.dev')
  expect(hidden).toEqual({
    hidden: { 'domain.remote.example.dev': true },
    showInheritedEdges: true,
  })
  expect(VISIBILITY_DEFAULT.hidden).toEqual({})
  expect(toggleVisibilityRef(hidden, 'domain.remote.example.dev')).toEqual(VISIBILITY_DEFAULT)
})
