import { expect, test } from 'bun:test'

import { canonicalCoreCount } from './process'

test('counts canonical Core nodes and edges without importing an implementation', () => {
  expect(
    canonicalCoreCount({
      nodes: { shell: {}, home: {} },
      edges: [{ source: {}, target: {} }],
    }),
  ).toBe(3)
  expect(canonicalCoreCount(undefined)).toBe(0)
})
