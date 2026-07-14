import type {
  DomainAnatomy,
  DomainSummary,
  IrClass,
  SchemaIR,
  StudioSchemaBundle,
} from '@shared/types'
import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import {
  composeWorkspaceCanvas,
  qualifiedNodeId,
  type WorkspaceDomainProjection,
} from './projection'

const nodeClass = (name: string): IrClass => ({
  type: 'node',
  name,
  properties: {},
  methods: {},
})

const anatomy = (origin: string): DomainAnatomy => ({
  overview: {
    origin,
    adapter: 'astrale',
    requires: [],
    astraleDeps: {},
    schemaDir: 'schema',
  },
  views: [],
  client: { routes: {}, shell: [], features: [], present: false },
  env: [],
  detectedIntegrations: [],
})

function bundle(
  id: string,
  origin: string,
  classes: SchemaIR['classes'],
  imports: SchemaIR['imports'] = {},
): StudioSchemaBundle {
  return {
    domainId: id,
    schemaHash: `${id}-hash`,
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: { version: '1', domain: origin, types: {}, interfaces: {}, classes, imports },
    overlay: {
      origin,
      requires: [],
      crossDomainImports: [],
      mixins: [],
      handlerLinks: [],
      sourceSpans: {},
      annotations: [],
    },
    extractedAt: '2026-07-13T00:00:00.000Z',
  }
}

function summary(id: string, origin: string): DomainSummary {
  return {
    id,
    origin,
    path: `/workspace/${id}`,
    schemaDir: 'schema',
    depsInstalled: true,
    hasGit: true,
    configFile: `/workspace/${id}/astrale.config.ts`,
  }
}

function prepared(schema: StudioSchemaBundle, names: string[]): WorkspaceDomainProjection {
  const input: WorkspaceDomainInput = {
    summary: summary(schema.domainId, schema.ir!.domain),
    bundle: schema,
    anatomy: anatomy(schema.ir!.domain),
    layout: { positions: {} },
    visibility: { hidden: {}, showInheritedEdges: true, materializedInterfaces: {} },
  }
  const nodes: Node[] = names.map((name, index) => ({
    id: `class.${name}`,
    type: 'classNode',
    position: { x: index * 220, y: 0 },
    data: {
      domainId: schema.domainId,
      name,
      props: 0,
      methods: 0,
      interfaces: [],
      hue: 200,
    },
    style: { width: 160, height: 60 },
  }))
  return { input, collapsed: new Set(), materialized: {}, nodes, edges: [] }
}

test('resolves a selected imported endpoint to the real qualified class node', () => {
  const services = prepared(
    bundle(
      'services',
      'services.astrale.ai',
      {
        Service: nodeClass('Service'),
        hosted_by_service: {
          type: 'edge',
          name: 'hosted_by_service',
          properties: {},
          methods: {},
          endpoints: [
            { name: 'service', types: ['Service'] },
            { name: 'function', types: ['Function'] },
          ],
        },
      },
      { Function: { origin: 'kernel.astrale.ai', definition: 'class' } },
    ),
    ['Service'],
  )
  const kernel = prepared(
    bundle('kernel', 'kernel.astrale.ai', { Function: nodeClass('Function') }),
    ['Function'],
  )

  const result = composeWorkspaceCanvas([services, kernel], 'services', {})
  expect(result.edges).toContainEqual(
    expect.objectContaining({
      source: qualifiedNodeId('services', 'class.Service'),
      target: qualifiedNodeId('kernel', 'class.Function'),
      data: expect.objectContaining({
        edgeClass: 'hosted_by_service',
        ownerDomainId: 'services',
      }),
    }),
  )
  expect(result.nodes.some((node) => node.id.includes('workspace-external-member'))).toBe(false)
})

test('keeps an unresolved target as one external stub when its domain is not selected', () => {
  const services = prepared(
    bundle(
      'services',
      'services.astrale.ai',
      {
        Service: nodeClass('Service'),
        hosted_by_service: {
          type: 'edge',
          name: 'hosted_by_service',
          properties: {},
          methods: {},
          endpoints: [
            { name: 'service', types: ['Service'] },
            { name: 'function', types: ['Function'] },
          ],
        },
      },
      { Function: { origin: 'kernel.astrale.ai', definition: 'class' } },
    ),
    ['Service'],
  )

  const result = composeWorkspaceCanvas([services], 'services', {})
  expect(result.nodes.filter((node) => node.id.includes('workspace-external-member'))).toHaveLength(
    1,
  )
  expect(result.edges).toHaveLength(1)
  expect(result.edges[0].target).toContain('workspace-external-member')
})

test('qualifies identical class names and edge identities by owning domain', () => {
  const alpha = prepared(bundle('alpha', 'alpha.dev', { Service: nodeClass('Service') }), [
    'Service',
  ])
  const beta = prepared(bundle('beta', 'beta.dev', { Service: nodeClass('Service') }), ['Service'])

  const result = composeWorkspaceCanvas([alpha, beta], 'alpha', {})
  const ids = new Set(result.nodes.map((node) => node.id))
  expect(ids.has(qualifiedNodeId('alpha', 'class.Service'))).toBe(true)
  expect(ids.has(qualifiedNodeId('beta', 'class.Service'))).toBe(true)
  expect(ids.size).toBe(result.nodes.length)
})

test('keeps owner-local geometry on draggable workspace nodes', () => {
  const services = prepared(bundle('services', 'services.dev', { Service: nodeClass('Service') }), [
    'Service',
  ])
  const result = composeWorkspaceCanvas([services], 'services', {}, undefined, {
    services: { x: 80, y: 96 },
  })
  const node = result.nodes.find(
    (candidate) => candidate.id === qualifiedNodeId('services', 'class.Service'),
  )

  expect(node).toEqual(
    expect.objectContaining({
      draggable: true,
      parentId: 'workspace-domain:services',
      position: { x: 80, y: 96 },
      data: expect.objectContaining({
        workspaceGeometry: {
          domainId: 'services',
          localId: 'class.Service',
          offset: { x: 80, y: 96 },
        },
      }),
    }),
  )
})

test('does not guess when two selected folders declare the same semantic origin', () => {
  const source = prepared(
    bundle(
      'source',
      'source.dev',
      {
        Source: nodeClass('Source'),
        links_to: {
          type: 'edge',
          name: 'links_to',
          properties: {},
          methods: {},
          endpoints: [
            { name: 'source', types: ['Source'] },
            { name: 'target', types: ['Target'] },
          ],
        },
      },
      { Target: { origin: 'shared.dev', definition: 'class' } },
    ),
    ['Source'],
  )
  const first = prepared(bundle('first', 'shared.dev', { Target: nodeClass('Target') }), ['Target'])
  const second = prepared(bundle('second', 'shared.dev', { Target: nodeClass('Target') }), [
    'Target',
  ])

  const result = composeWorkspaceCanvas([source, first, second], 'source', {})
  expect(result.diagnostics.join(' ')).toContain('Multiple selected folders declare shared.dev')
  expect(result.edges[0].target).toContain('workspace-external-member')
})
