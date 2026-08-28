import { expect, test } from 'bun:test'

import { detailRefFor, flowEdgeAnchorRef, parseMemberFieldRef } from './targets'

test('normalizes workspace internal and cross-domain edge ids to their declaring edge class', () => {
  expect(flowEdgeAnchorRef('workspace:services:edge-hosted_by_service__a__b')).toBe(
    'edge.hosted_by_service',
  )
  expect(flowEdgeAnchorRef('workspace-edge:services:hosted_by_service:a:b')).toBe(
    'edge.hosted_by_service',
  )
})

test('splits a member field ref from the member that owns it', () => {
  expect(parseMemberFieldRef('class.Code.property.total')).toEqual({
    owner: 'class.Code',
    kind: 'property',
    name: 'total',
  })
  expect(parseMemberFieldRef('edge.assigned_to.endpoint.owner')).toEqual({
    owner: 'edge.assigned_to',
    kind: 'endpoint',
    name: 'owner',
  })
  // an imported Class carries its origin key, dots and all, before the field segment
  expect(parseMemberFieldRef('class.docs.example.dev:class.Document.method.publish')).toEqual({
    owner: 'class.docs.example.dev:class.Document',
    kind: 'method',
    name: 'publish',
  })
})

test('only a field resolves to a different detail view', () => {
  expect(detailRefFor('class.Code.property.total')).toBe('class.Code')
  expect(detailRefFor('class.Code')).toBe('class.Code')
  expect(detailRefFor('module.billing')).toBe('module.billing')
  expect(parseMemberFieldRef('section.schema')).toBeNull()
})
