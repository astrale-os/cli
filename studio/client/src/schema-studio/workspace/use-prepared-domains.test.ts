import { expect, test } from 'bun:test'

import type { WorkspaceDomainProjection } from './projection'

import { preparedWorkspaceStatus } from './use-prepared-domains'

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
