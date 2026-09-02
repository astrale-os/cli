import { expect, test } from 'bun:test'

import {
  anchorData,
  anchorKey,
  anchorKindForRef,
  decodeFlowNodeId,
  domainAnchorRef,
  detailRefFor,
  encodeFlowNodeId,
  flowEdgeAnchorRef,
  flowEdgeOwnerDomainId,
  flowNodeAnchorRef,
  parseMemberFieldRef,
} from './targets'

test('uses one stable domain-qualified key for comments and Ask', () => {
  expect(anchorKey('billing', 'class.Invoice')).toBe('billing::class.Invoice')
})

test('decodes workspace node ids without losing colons in the local ref', () => {
  expect(encodeFlowNodeId('https://docs.dev', 'class.remote:Document')).toBe(
    'workspace:https%3A%2F%2Fdocs.dev:class.remote:Document',
  )
  expect(decodeFlowNodeId('workspace:docs.example.dev:class.Document')).toEqual({
    domainId: 'docs.example.dev',
    localId: 'class.Document',
  })
  expect(decodeFlowNodeId('workspace:https%3A%2F%2Fdocs.dev:class.remote:Document')).toEqual({
    domainId: 'https://docs.dev',
    localId: 'class.remote:Document',
  })
  expect(flowNodeAnchorRef('workspace:billing:grp-sales.orders')).toBe('module.sales.orders')
})

test('normalizes workspace internal and cross-domain edge ids to their declaring edge class', () => {
  expect(flowEdgeAnchorRef('workspace:services:edge-hosted_by_service__a__b')).toBe(
    'edge.hosted_by_service',
  )
  expect(flowEdgeAnchorRef('workspace-edge:services:hosted_by_service:a:b')).toBe(
    'edge.hosted_by_service',
  )
  expect(flowEdgeOwnerDomainId('workspace:services:edge-hosted_by_service__a__b')).toBe('services')
  expect(flowEdgeOwnerDomainId('workspace-edge:docs.example.dev:links:a:b')).toBe(
    'docs.example.dev',
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

test('a domain is a scope in the target hierarchy, keyed by origin', () => {
  const ref = domainAnchorRef('crm.studio-demo.astrale.ai')
  expect(ref).toBe('domain.crm.studio-demo.astrale.ai')
  // a scope, like a module or a section — not a schema member
  expect(anchorKindForRef(ref)).toBe('section')
  expect(anchorKindForRef('module.billing')).toBe('section')
  expect(anchorKindForRef('class.Order')).toBe('schema')
  // the whole domain IS the target — nothing coarser contains it
  expect(detailRefFor(ref)).toBe(ref)
  // dots in an origin are not field separators
  expect(parseMemberFieldRef(ref)).toBeNull()
})

test('an anchor can name the domain whose threads it belongs to', () => {
  // The rail lists domains the canvas may not draw, so there is no `data-domain-id`
  // around its rows to fall back on — the owner has to ride on the anchor.
  expect(anchorData('domain.ops.example.dev', 'ops.example.dev', 'peer')).toEqual({
    'data-anchor-ref': 'domain.ops.example.dev',
    'data-anchor-excerpt': 'ops.example.dev',
    'data-anchor-domain-id': 'peer',
    'data-commentable': '',
  })
  // left out where the surface already sits inside the domain it belongs to
  expect(anchorData('class.Order', 'Order')['data-anchor-domain-id']).toBeUndefined()
})
