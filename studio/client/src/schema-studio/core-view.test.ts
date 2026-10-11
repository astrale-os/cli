import type { StudioCore, StudioSchemaBundle } from '@shared/contracts/schema'

import { expect, test } from 'bun:test'

import { buildCoreGraph, coreDataEntries, displayName, previewFields } from './core-view/model'

test('renders canonical Core edges connected to the owning Domain endpoint', () => {
  const core: StudioCore = {
    domain: 'shell.astrale.ai',
    nodes: [{ path: '/:shell.astrale.ai:core.shell', className: 'Shell', data: { name: 'Shell' } }],
    edges: [
      { from: '/:shell.astrale.ai:core.shell', to: '/:shell.astrale.ai', edgeName: 'serves' },
    ],
    extractedAt: '2026-08-20T00:00:00.000Z',
  }
  const bundle = { ir: { classes: {} } } as StudioSchemaBundle

  const graph = buildCoreGraph(core, bundle, new Map(), 'shell')

  expect(graph.nodes.find((node) => node.data.path === '/:shell.astrale.ai')?.data).toMatchObject({
    className: 'Domain',
    virtual: true,
  })
  expect(graph.edges).toEqual([
    expect.objectContaining({
      source: 'core.node./:shell.astrale.ai:core.shell',
      target: 'core.node./:shell.astrale.ai',
      data: { label: 'serves', index: 0 },
    }),
  ])
})

test('presents canonical Core property keys without losing ambiguous identities', () => {
  const node = {
    path: '/:documents.example.dev:core.welcome',
    data: {
      'documents.example.dev:class.Document.property.name': 'Welcome',
      'metadata.example.dev:interface.Labelled.property.label': 'Primary',
      'legacy.example.dev:interface.Labelled.property.label': 'Legacy',
      healthy: true,
    },
  }

  expect(displayName(node)).toBe('Welcome')
  expect(previewFields(node)).toEqual([
    ['metadata.example.dev:interface.Labelled.property.label', 'Primary'],
    ['legacy.example.dev:interface.Labelled.property.label', 'Legacy'],
  ])
  // a unique property name reads short; two that collide keep their full identity
  expect(coreDataEntries(node.data).map(({ label }) => label)).toEqual([
    'name',
    'metadata.example.dev:interface.Labelled.property.label',
    'legacy.example.dev:interface.Labelled.property.label',
    'healthy',
  ])
})
