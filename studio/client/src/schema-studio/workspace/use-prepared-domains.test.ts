import { expect, test } from 'bun:test'

import type { WorkspaceDomainProjection } from './projection'

import { evictStaleProjections, preparedWorkspaceStatus } from './use-prepared-domains'

const drawn = {} as WorkspaceDomainProjection

test('a same-sized workspace never renders projections prepared for the prior selection', () => {
  expect(
    preparedWorkspaceStatus('other-domain', 1, { selection: 'some-domain', domains: [drawn] }),
  ).toEqual({ domains: [], ready: false })
})

// A drag persisted, a class hidden, a module collapsed: the projection is rebuilt for the
// SAME domains. Handing back an empty canvas there unmounts React Flow, and what remounts
// has lost the viewport — which is how a drop used to re-frame the whole graph.
test('a re-projection of the same selection keeps the canvas already on screen', () => {
  expect(
    preparedWorkspaceStatus('some-domain', 1, { selection: 'some-domain', domains: [drawn] }),
  ).toEqual({ domains: [drawn], ready: true })
})

test('nothing prepared yet is never ready, not even for an empty workspace', () => {
  expect(preparedWorkspaceStatus('', 0, { selection: null, domains: [] })).toEqual({
    domains: [],
    ready: false,
  })
})

// Taking a domain off the canvas is now the ONLY gesture for it, so it has to be cheap to
// undo: the projection outlives the unchecking, and re-checking repaints instead of
// re-running ELK over the whole domain.
test('an unchecked domain keeps its projection until the cache is actually full', () => {
  const cache = new Map([
    ['issues', 1],
    ['shell', 2],
    ['services', 3],
  ])

  evictStaleProjections(cache, ['issues'], 3)

  expect([...cache.keys()]).toEqual(['shell', 'services', 'issues'])
})

test('evicts the least recently drawn first, and never what is on the canvas', () => {
  const cache = new Map([
    ['oldest', 1],
    ['older', 2],
    ['issues', 3],
  ])

  evictStaleProjections(cache, ['issues'], 2)

  expect([...cache.keys()]).toEqual(['older', 'issues'])
})
