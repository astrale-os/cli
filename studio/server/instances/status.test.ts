import { expect, test } from 'bun:test'

import { schemaRevisionDrift } from './status'

test('computes drift only from two admitted canonical revisions', () => {
  const local = `sha256:${'a'.repeat(64)}` as const
  const other = `sha256:${'b'.repeat(64)}` as const
  expect(schemaRevisionDrift(local, local)).toBe('in-sync')
  expect(schemaRevisionDrift(local, other)).toBe('drifted')
  expect(schemaRevisionDrift(local, null)).toBe('unknown')
  expect(schemaRevisionDrift(null, other)).toBe('unknown')
})
