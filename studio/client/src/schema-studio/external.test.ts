import type { IrClass, IrInterface, SchemaIR, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { crossDomainEdges, externalDomains, localEndpointTargets } from './external'

const node = (name: string): IrClass => ({
  type: 'node',
  name,
  properties: {},
  methods: {},
})

function bundle(
  classes: SchemaIR['classes'],
  interfaces: SchemaIR['interfaces'] = {},
  imports: SchemaIR['imports'] = {
    Identity: { origin: 'kernel.astrale.ai', definition: 'interface' },
  },
): StudioSchemaBundle {
  return {
    domainId: 'example',
    schemaHash: 'test',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      version: '1',
      domain: 'example.test',
      types: {},
      interfaces,
      classes,
      imports,
    },
    overlay: {
      origin: 'example.test',
      requires: [],
      crossDomainImports: [],
      mixins: [],
      handlerLinks: [],
      sourceSpans: {},
      annotations: [],
    },
    extractedAt: '2026-01-01T00:00:00.000Z',
  }
}

const iface = (name: string): IrInterface => ({
  type: 'interface',
  name,
  properties: {},
  methods: {},
})

test('renders an edge whose imported endpoint is an interface', () => {
  const input = bundle({
    Issue: node('Issue'),
    issue_assigned_to: {
      type: 'edge',
      name: 'issue_assigned_to',
      properties: {},
      methods: {},
      endpoints: [
        { name: 'issue', types: ['Issue'] },
        { name: 'assignee', types: ['Identity'] },
      ],
    },
  })

  expect(crossDomainEdges(input)).toEqual([
    {
      edge: 'issue_assigned_to',
      from: 'Issue',
      origin: 'kernel.astrale.ai',
      to: 'Identity',
      fromCard: undefined,
      toCard: undefined,
    },
  ])
  expect(externalDomains(input)).toEqual([
    {
      origin: 'kernel.astrale.ai',
      kind: 'kernel',
      members: [{ name: 'Identity', definition: 'interface' }],
    },
  ])
})

test('keeps cardinality attached to each endpoint when the imported interface comes first', () => {
  const many = { min: 0, max: null }
  const one = { min: 1, max: 1 }
  const input = bundle({
    Channel: node('Channel'),
    subscribed_to: {
      type: 'edge',
      name: 'subscribed_to',
      properties: {},
      methods: {},
      endpoints: [
        { name: 'subscriber', types: ['Identity'], cardinality: many },
        { name: 'channel', types: ['Channel'], cardinality: one },
      ],
    },
  })

  expect(crossDomainEdges(input)).toEqual([
    {
      edge: 'subscribed_to',
      from: 'Channel',
      origin: 'kernel.astrale.ai',
      to: 'Identity',
      fromCard: one,
      toCard: many,
    },
  ])
})

test('discovers a kernel class relation declared through a local interface', () => {
  const input = bundle(
    {
      CloudflareWorker: { ...node('CloudflareWorker'), implements: ['Service'] },
      hosted_by_service: {
        type: 'edge',
        name: 'hosted_by_service',
        properties: {},
        methods: {},
        endpoints: [
          { name: 'function', types: ['Function'] },
          { name: 'service', types: ['Service'], cardinality: { min: 1, max: 1 } },
        ],
      },
    },
    { Service: iface('Service') },
    { Function: { origin: 'kernel.astrale.ai', definition: 'class' } },
  )

  expect(crossDomainEdges(input)).toEqual([
    {
      edge: 'hosted_by_service',
      from: 'Service',
      origin: 'kernel.astrale.ai',
      to: 'Function',
      fromCard: { min: 1, max: 1 },
      toCard: undefined,
    },
  ])
  expect(externalDomains(input)).toEqual([
    {
      origin: 'kernel.astrale.ai',
      kind: 'kernel',
      members: [{ name: 'Function', definition: 'class' }],
    },
  ])

  const serviceEndpoint = input.ir!.classes.hosted_by_service.endpoints![1]
  expect(localEndpointTargets(input.ir!, serviceEndpoint, () => false)).toEqual([
    { cls: 'CloudflareWorker', ifaceNode: null, viaInterface: 'Service' },
  ])
  expect(localEndpointTargets(input.ir!, serviceEndpoint, (name) => name === 'Service')).toEqual([
    { cls: null, ifaceNode: 'iface.Service', viaInterface: null },
  ])
})
