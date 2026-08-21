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

import { workspaceExternalMemberNodeId, workspaceExternalNodeId } from './external-frames'
import { DOMAIN_MIN_SIZE, WORKSPACE_DOMAIN_GAP } from './geometry'
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
    renderFingerprint: `${id}-fingerprint`,
    schemaMode: 'legacy',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      version: '1',
      domain: origin,
      types: {},
      interfaces: {},
      classes,
      imports,
      functions: {},
    },
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

  const result = composeWorkspaceCanvas([services, kernel], { activeDomainId: 'services' })
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

  const result = composeWorkspaceCanvas([services], { activeDomainId: 'services' })
  expect(result.nodes.filter((node) => node.id.includes('workspace-external-member'))).toHaveLength(
    1,
  )
  expect(result.edges).toHaveLength(1)
  expect(result.edges[0].target).toContain('workspace-external-member')
})

test('keeps an external frame anchored to its relationship owner when an unrelated domain moves', () => {
  const issues = prepared(
    bundle(
      'issues',
      'issues.astrale.ai',
      {
        Issue: nodeClass('Issue'),
        issue_reported_by: {
          type: 'edge',
          name: 'issue_reported_by',
          properties: {},
          methods: {},
          endpoints: [
            { name: 'issue', types: ['Issue'] },
            { name: 'identity', types: ['Identity'] },
          ],
        },
      },
      { Identity: { origin: 'kernel.astrale.ai', definition: 'class' } },
    ),
    ['Issue'],
  )
  const integration = prepared(
    bundle('integration', 'integration.astrale.ai', { Integration: nodeClass('Integration') }),
    ['Integration'],
  )
  const initial = composeWorkspaceCanvas([issues, integration], {
    activeDomainId: 'issues',
    domainPositions: {
      issues: { x: 0, y: 0 },
      integration: { x: 0, y: 600 },
    },
  })
  const issueFrame = initial.nodes.find((node) => node.id === 'workspace-domain:issues')!
  const kernelId = workspaceExternalNodeId('kernel.astrale.ai')
  const initialKernel = initial.nodes.find((node) => node.id === kernelId)!

  expect(initialKernel.position).toEqual({
    x: issueFrame.position.x + Number(issueFrame.style?.width) + WORKSPACE_DOMAIN_GAP,
    y: issueFrame.position.y,
  })

  const moved = composeWorkspaceCanvas([issues, integration], {
    activeDomainId: 'issues',
    contentOffsets: initial.contentOffsets,
    domainPositions: {
      ...initial.domainPositions,
      integration: { x: 1600, y: 600 },
    },
    externalPositions: initial.externalPositions,
  })
  const movedKernel = moved.nodes.find((node) => node.id === kernelId)!

  expect(movedKernel.position).toEqual(initialKernel.position)
  expect(moved.externalPositions['kernel.astrale.ai']).toEqual(
    initial.externalPositions['kernel.astrale.ai'],
  )
})

test('qualifies identical class names and edge identities by owning domain', () => {
  const alpha = prepared(bundle('alpha', 'alpha.dev', { Service: nodeClass('Service') }), [
    'Service',
  ])
  const beta = prepared(bundle('beta', 'beta.dev', { Service: nodeClass('Service') }), ['Service'])

  const result = composeWorkspaceCanvas([alpha, beta], { activeDomainId: 'alpha' })
  const ids = new Set(result.nodes.map((node) => node.id))
  expect(ids.has(qualifiedNodeId('alpha', 'class.Service'))).toBe(true)
  expect(ids.has(qualifiedNodeId('beta', 'class.Service'))).toBe(true)
  expect(ids.size).toBe(result.nodes.length)
})

test('keeps owner-local geometry on draggable workspace nodes', () => {
  const services = prepared(bundle('services', 'services.dev', { Service: nodeClass('Service') }), [
    'Service',
  ])
  const result = composeWorkspaceCanvas([services], {
    activeDomainId: 'services',
    contentOffsets: { services: { x: 80, y: 96 } },
  })
  const node = result.nodes.find(
    (candidate) => candidate.id === qualifiedNodeId('services', 'class.Service'),
  )

  expect(node).toEqual(
    expect.objectContaining({
      draggable: true,
      expandParent: false,
      parentId: 'workspace-domain:services',
      position: { x: 80, y: 96 },
      data: expect.objectContaining({
        workspaceGeometry: {
          domainId: 'services',
          localId: 'class.Service',
          offset: { x: 80, y: 96 },
          active: true,
        },
      }),
    }),
  )
})

test('only makes nodes inside the active domain interactive', () => {
  const alpha = prepared(bundle('alpha', 'alpha.dev', { Service: nodeClass('Service') }), [
    'Service',
  ])
  const beta = prepared(bundle('beta', 'beta.dev', { Worker: nodeClass('Worker') }), ['Worker'])

  const result = composeWorkspaceCanvas([alpha, beta], { activeDomainId: 'alpha' })
  const alphaClass = result.nodes.find(
    (node) => node.id === qualifiedNodeId('alpha', 'class.Service'),
  )
  const betaClass = result.nodes.find((node) => node.id === qualifiedNodeId('beta', 'class.Worker'))
  const betaDomain = result.nodes.find((node) => node.id === 'workspace-domain:beta')

  expect(alphaClass).toEqual(
    expect.objectContaining({ draggable: true, selectable: true, focusable: true }),
  )
  expect(betaClass).toEqual(
    expect.objectContaining({
      draggable: false,
      selectable: false,
      focusable: false,
      style: expect.objectContaining({ pointerEvents: 'none' }),
    }),
  )
  expect(betaDomain).toEqual(
    expect.objectContaining({
      draggable: true,
      dragHandle: '.workspace-domain-drag-handle',
      selectable: true,
    }),
  )
})

test('applies persisted domain sizes without allowing content to be covered', () => {
  const services = prepared(bundle('services', 'services.dev', { Service: nodeClass('Service') }), [
    'Service',
  ])
  const expanded = composeWorkspaceCanvas([services], {
    activeDomainId: 'services',
    contentOffsets: { services: { x: 80, y: 96 } },
    domainSizes: { services: { width: 720, height: 540 } },
  })
  const expandedDomain = expanded.nodes.find((node) => node.id === 'workspace-domain:services')!
  expect(expandedDomain.style).toEqual(expect.objectContaining({ width: 720, height: 540 }))

  const clamped = composeWorkspaceCanvas([services], {
    activeDomainId: 'services',
    contentOffsets: { services: { x: 80, y: 96 } },
    domainSizes: { services: { width: 10, height: 10 } },
  })
  const clampedDomain = clamped.nodes.find((node) => node.id === 'workspace-domain:services')!
  expect(clampedDomain.style).toEqual(
    expect.objectContaining({ width: DOMAIN_MIN_SIZE.width, height: DOMAIN_MIN_SIZE.height }),
  )
})

test('does not repack sibling domains after one domain is resized', () => {
  const alpha = prepared(bundle('alpha', 'alpha.dev', { Service: nodeClass('Service') }), [
    'Service',
  ])
  const beta = prepared(bundle('beta', 'beta.dev', { Worker: nodeClass('Worker') }), ['Worker'])
  const initial = composeWorkspaceCanvas([alpha, beta], { activeDomainId: 'alpha' })
  const initialBeta = initial.nodes.find((node) => node.id === 'workspace-domain:beta')!
  const resized = composeWorkspaceCanvas([alpha, beta], {
    activeDomainId: 'alpha',
    contentOffsets: initial.contentOffsets,
    domainPositions: initial.domainPositions,
    domainSizes: { alpha: { width: 800, height: 500 } },
  })
  const resizedBeta = resized.nodes.find((node) => node.id === 'workspace-domain:beta')!

  expect(resizedBeta.position).toEqual(initialBeta.position)
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

  const result = composeWorkspaceCanvas([source, first, second], { activeDomainId: 'source' })
  expect(result.diagnostics.join(' ')).toContain('Multiple selected folders declare shared.dev')
  expect(result.edges[0].target).toContain('workspace-external-member')
})

test('keeps homonymous exact endpoint refs distinct by origin and kind', () => {
  const source = prepared(
    bundle('source', 'source.dev', {
      Source: nodeClass('Source'),
      Shared: nodeClass('Shared'),
      links_to: {
        type: 'edge',
        name: 'links_to',
        properties: {},
        methods: {},
        endpoints: [
          {
            name: 'source',
            types: ['Source'],
            refs: [{ origin: 'source.dev', kind: 'class', name: 'Source' }],
          },
          {
            name: 'target',
            types: ['Shared', 'Shared', 'Shared'],
            refs: [
              { origin: 'a.dev', kind: 'interface', name: 'Shared' },
              { origin: 'b.dev', kind: 'interface', name: 'Shared' },
              { origin: 'a.dev', kind: 'class', name: 'Shared' },
            ],
          },
        ],
      },
    }),
    ['Source', 'Shared'],
  )
  source.input.bundle.ir!.format = 'astrale.dsl'
  source.input.bundle.ir!.importsByKey = {
    'a.dev:interface.Shared': {
      origin: 'a.dev',
      definition: 'interface',
      ref: { origin: 'a.dev', kind: 'interface', name: 'Shared' },
      key: 'a.dev:interface.Shared',
    },
    'b.dev:interface.Shared': {
      origin: 'b.dev',
      definition: 'interface',
      ref: { origin: 'b.dev', kind: 'interface', name: 'Shared' },
      key: 'b.dev:interface.Shared',
    },
    'a.dev:class.Shared': {
      origin: 'a.dev',
      definition: 'class',
      ref: { origin: 'a.dev', kind: 'class', name: 'Shared' },
      key: 'a.dev:class.Shared',
    },
  }

  const result = composeWorkspaceCanvas([source], { activeDomainId: 'source' })
  const targetIds = [
    workspaceExternalMemberNodeId('a.dev', 'Shared', 'interface'),
    workspaceExternalMemberNodeId('b.dev', 'Shared', 'interface'),
    workspaceExternalMemberNodeId('a.dev', 'Shared', 'class'),
  ]

  expect(targetIds.every((id) => result.nodes.some((node) => node.id === id))).toBe(true)
  expect(new Set(result.edges.map((edge) => edge.target))).toEqual(new Set(targetIds))
  expect(
    result.edges.some((edge) => edge.target === qualifiedNodeId('source', 'class.Shared')),
  ).toBe(false)
})
