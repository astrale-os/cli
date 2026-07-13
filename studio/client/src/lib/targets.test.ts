import { expect, test } from 'bun:test'

import { flowEdgeAnchorRef } from './targets'

test('normalizes workspace internal and cross-domain edge ids to their declaring edge class', () => {
  expect(flowEdgeAnchorRef('workspace:services:edge-hosted_by_service__a__b')).toBe(
    'edge.hosted_by_service',
  )
  expect(flowEdgeAnchorRef('workspace-edge:services:hosted_by_service:a:b')).toBe(
    'edge.hosted_by_service',
  )
})
