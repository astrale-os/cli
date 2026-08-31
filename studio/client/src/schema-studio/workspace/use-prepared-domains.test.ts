import { expect, test } from 'bun:test'

import type { WorkspaceDomainProjection } from './projection'

import { preparedWorkspaceStatus } from './use-prepared-domains'

test('a same-sized workspace never renders projections prepared for the prior selection', () => {
  const oldDomain = {} as WorkspaceDomainProjection
  expect(
    preparedWorkspaceStatus('new-domain-key', 1, {
      key: 'old-domain-key',
      domains: [oldDomain],
    }),
  ).toEqual({ domains: [], ready: false })

  expect(
    preparedWorkspaceStatus('new-domain-key', 1, {
      key: 'new-domain-key',
      domains: [oldDomain],
    }),
  ).toEqual({ domains: [oldDomain], ready: true })
})
