import { expect, test } from 'bun:test'

import { pointerWatch } from './pointer'

test('a pointer moving onto an element points at it', () => {
  const watch = pointerWatch()
  expect(watch.pointed(10, 10)).toBe(true)
  watch.moved(10, 10)
  watch.moved(40, 12)
  // Boundary events come before the move that crossed the boundary.
  expect(watch.pointed(64, 12)).toBe(true)
  watch.moved(64, 12)
})

test('what slides under a still pointer is not pointed at: the old focus lights no lines', () => {
  const watch = pointerWatch()
  // The reader clicks a row: the pointer came to rest on it.
  expect(watch.pointed(120, 248)).toBe(true)
  watch.moved(120, 248)
  // The camera glides to frame the new focus, or the Index reflows as it filters: another
  // element reports the pointer over it, at the very pixel the pointer rests on.
  expect(watch.pointed(120, 248)).toBe(false)
  expect(watch.pointed(120, 248)).toBe(false)
  // Once the reader moves again, what is under the pointer is theirs.
  watch.moved(121, 249)
  expect(watch.pointed(122, 250)).toBe(true)
})
