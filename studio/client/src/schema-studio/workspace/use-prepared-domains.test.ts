import { expect, test } from 'bun:test'

import type { WorkspaceDomainProjection } from './projection'

import { evictStaleProjections, preparedWorkspaceStatus } from './use-prepared-domains'

function projection(id: string): WorkspaceDomainProjection {
  return { input: { summary: { id } } } as WorkspaceDomainProjection
}

const drawn = projection('some-domain')

test('a same-sized workspace never renders projections prepared for the prior selection', () => {
  expect(
    preparedWorkspaceStatus(['other-domain'], {
      selection: 'some-domain',
      domains: [drawn],
    }),
  ).toEqual({ domains: [], ready: false })
})

test('removing a domain retains every projection still on the canvas', () => {
  const removed = projection('removed-domain')

  expect(
    preparedWorkspaceStatus(['some-domain'], {
      selection: 'some-domain::removed-domain',
      domains: [drawn, removed],
    }),
  ).toEqual({ domains: [drawn], ready: true })
})

test('adding a domain keeps the current canvas visible until the addition is prepared', () => {
  expect(
    preparedWorkspaceStatus(['some-domain', 'added-domain'], {
      selection: 'some-domain',
      domains: [drawn],
    }),
  ).toEqual({ domains: [drawn], ready: false })
})

// A drag persisted, a class hidden, a module collapsed: the projection is rebuilt for the
// SAME domains. Handing back an empty canvas there unmounts React Flow, and what remounts
// has lost the viewport — which is how a drop used to re-frame the whole graph.
test('a re-projection of the same selection keeps the canvas already on screen', () => {
  const domains = [drawn]
  const status = preparedWorkspaceStatus(['some-domain'], {
    selection: 'some-domain',
    domains,
  })

  expect(status).toEqual({ domains: [drawn], ready: true })
  expect(status.domains).toBe(domains)
})

test('nothing prepared yet is never ready, not even for an empty workspace', () => {
  expect(preparedWorkspaceStatus([], { selection: null, domains: [] })).toEqual({
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
