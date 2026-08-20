import type {
  IrClass,
  IrDefinitionRef,
  IrInterface,
  SchemaIR,
  StudioSchemaBundle,
} from '@shared/types'

import { expect, test } from 'bun:test'

import {
  crossDomainEdges,
  externalDomains,
  externalMemberNodeId,
  localEndpointTargets,
} from './external'

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
      functions: {},
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

test('uses exact endpoint refs across local and imported class/interface name collisions', () => {
  const localInterface = {
    origin: 'example.test',
    kind: 'interface',
    name: 'Thing',
  } satisfies IrDefinitionRef
  const externalClass = {
    origin: 'catalog.example.dev',
    kind: 'class',
    name: 'Thing',
  } satisfies IrDefinitionRef
  const externalInterface = {
    origin: 'catalog.example.dev',
    kind: 'interface',
    name: 'Thing',
  } satisfies IrDefinitionRef
  const input = bundle(
    {
      Thing: node('Thing'),
      ThingImplementer: {
        ...node('ThingImplementer'),
        implements: ['Thing'],
        implementsRefs: [localInterface],
      },
      relates_to_thing: {
        type: 'edge',
        name: 'relates_to_thing',
        properties: {},
        methods: {},
        endpoints: [
          { name: 'local', types: ['Thing'], refs: [localInterface] },
          {
            name: 'external',
            types: ['Thing', 'Thing'],
            refs: [externalClass, externalInterface],
          },
        ],
      },
    },
    { Thing: iface('Thing') },
    {},
  )
  input.ir!.importsByKey = {
    'catalog.example.dev:class.Thing': {
      origin: externalClass.origin,
      definition: 'class',
      ref: externalClass,
    },
    'catalog.example.dev:interface.Thing': {
      origin: externalInterface.origin,
      definition: 'interface',
      ref: externalInterface,
    },
  }

  const localEndpoint = input.ir!.classes.relates_to_thing.endpoints![0]
  expect(localEndpointTargets(input.ir!, localEndpoint, () => false)).toEqual([
    { cls: 'ThingImplementer', ifaceNode: null, viaInterface: 'Thing' },
  ])
  expect(localEndpointTargets(input.ir!, localEndpoint, () => true)).toEqual([
    { cls: null, ifaceNode: 'iface.Thing', viaInterface: null },
  ])
  expect(crossDomainEdges(input)).toEqual([
    {
      edge: 'relates_to_thing',
      from: 'Thing',
      fromRef: localInterface,
      origin: 'catalog.example.dev',
      to: 'Thing',
      toRef: externalClass,
      fromCard: undefined,
      toCard: undefined,
    },
    {
      edge: 'relates_to_thing',
      from: 'Thing',
      fromRef: localInterface,
      origin: 'catalog.example.dev',
      to: 'Thing',
      toRef: externalInterface,
      fromCard: undefined,
      toCard: undefined,
    },
  ])
  expect(externalDomains(input)).toEqual([
    {
      origin: 'catalog.example.dev',
      kind: 'external',
      members: [
        { name: 'Thing', definition: 'class', ref: externalClass },
        { name: 'Thing', definition: 'interface', ref: externalInterface },
      ],
    },
  ])
  expect(externalMemberNodeId(externalClass.origin, externalClass.name, 'class')).toBe(
    'extmember.catalog.example.dev.class.Thing',
  )
  expect(externalMemberNodeId(externalInterface.origin, externalInterface.name, 'interface')).toBe(
    'extmember.catalog.example.dev.interface.Thing',
  )
})
