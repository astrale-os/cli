import { expect, test } from 'bun:test'

import { concreteAnchorKind, isConcreteAnchorRef } from './comment-anchors'

test('recognizes every concrete comment target and infers its persisted kind', () => {
  expect(concreteAnchorKind('class.Order.property.total')).toBe('schema')
  expect(concreteAnchorKind('edge.owns.endpoint.owner')).toBe('schema')
  expect(concreteAnchorKind('function.createOrder')).toBe('schema')
  expect(concreteAnchorKind('domain.orders.example.dev')).toBe('section')
  expect(concreteAnchorKind('module.sales/orders')).toBe('section')
  expect(concreteAnchorKind('view.order-list')).toBe('section')
  expect(concreteAnchorKind('section.integrations.stripe')).toBe('section')
  expect(concreteAnchorKind('integration.request.stripe')).toBe('section')
  expect(concreteAnchorKind('core.node./:orders.example.dev:core.root')).toBe('section')
  expect(concreteAnchorKind('file.schema/order.ts')).toBe('file')
})

test('rejects broad, malformed, and kind-mismatched anchors', () => {
  for (const ref of ['', 'class.', 'section.schema', 'free.canvas', 'somewhere', ' class.Order']) {
    expect(concreteAnchorKind(ref)).toBeUndefined()
  }
  expect(isConcreteAnchorRef({ ref: 'class.Order', kind: 'schema' })).toBe(true)
  expect(isConcreteAnchorRef({ ref: 'class.Order', kind: 'section' })).toBe(false)
})
