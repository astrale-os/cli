import { expect, test } from 'bun:test'

import type { WorkspaceDomainProjection } from './projection'

import { evictStaleProjections, preparedWorkspaceStatus } from './use-prepared-domains'

const projection = (id: string) => ({ input: { summary: { id } } }) as WorkspaceDomainProjection
const drawn = projection('some-domain')

test('the canvas only ever shows projections prepared for what is selected now', () => {
  // a same-sized workspace never renders the prior selection
  expect(
    preparedWorkspaceStatus(['other-domain'], { selection: 'some-domain', domains: [drawn] }),
  ).toEqual({ domains: [], ready: false })
  // removing a domain keeps every projection still on the canvas
  expect(
    preparedWorkspaceStatus(['some-domain'], {
      selection: 'some-domain::removed-domain',
      domains: [drawn, projection('removed-domain')],
    }),
  ).toEqual({ domains: [drawn], ready: true })
  // adding one keeps the current canvas visible until the addition is prepared
  expect(
    preparedWorkspaceStatus(['some-domain', 'added-domain'], {
      selection: 'some-domain',
      domains: [drawn],
    }),
  ).toEqual({ domains: [drawn], ready: false })
  expect(preparedWorkspaceStatus([], { selection: null, domains: [] }).ready).toBe(false)
})

// A drag persisted or a module collapsed re-projects the SAME domains: handing back a new
// array would remount React Flow and lose the viewport.
test('a re-projection of the same selection keeps the very array already on screen', () => {
  const domains = [drawn]
  expect(
    preparedWorkspaceStatus(['some-domain'], { selection: 'some-domain', domains }).domains,
  ).toBe(domains)
})

test('eviction drops the least recently drawn first, never what is on the canvas', () => {
  const cache = new Map([
    ['oldest', 1],
    ['older', 2],
    ['issues', 3],
  ])
  evictStaleProjections(cache, ['issues'], 3)
  expect([...cache.keys()]).toEqual(['oldest', 'older', 'issues'])
  evictStaleProjections(cache, ['issues'], 2)
  expect([...cache.keys()]).toEqual(['older', 'issues'])
})
