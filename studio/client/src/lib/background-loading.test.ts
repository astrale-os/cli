import { expect, test } from 'bun:test'

import { workspaceResourceEnabled } from './hooks'

test('workspace-wide background resources wait without owning the schema loader', () => {
  expect(workspaceResourceEnabled(false, false)).toBe(false)
  expect(workspaceResourceEnabled(false, true)).toBe(true)
})

test('a resource being viewed loads immediately and independently', () => {
  expect(workspaceResourceEnabled(true, false)).toBe(true)
})
