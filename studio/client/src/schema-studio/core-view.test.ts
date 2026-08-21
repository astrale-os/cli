import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { buildCoreGraph } from './core-view'
import { coreDataEntries, displayName, previewFields } from './core-view/model'

test('renders canonical Core edges connected to the owning Domain endpoint', () => {
  const core: StudioCore = {
    domain: 'shell.astrale.ai',
    nodes: [
      {
        path: '/:shell.astrale.ai:core.shell',
        className: 'Shell',
        data: { name: 'Shell' },
      },
    ],
    edges: [
      {
        from: '/:shell.astrale.ai:core.shell',
        to: '/:shell.astrale.ai',
        edgeName: 'serves',
      },
    ],
    extractedAt: '2026-08-20T00:00:00.000Z',
  }
  const bundle = {
    ir: { classes: {} },
  } as StudioSchemaBundle

  const graph = buildCoreGraph(core, bundle, new Map())

  expect(graph.nodes.map((node) => node.data.path)).toContain('/:shell.astrale.ai')
  expect(graph.nodes.find((node) => node.data.path === '/:shell.astrale.ai')?.data).toMatchObject({
    className: 'Domain',
    virtual: true,
  })
  expect(graph.edges).toEqual([
    expect.objectContaining({
      source: 'core.node./:shell.astrale.ai:core.shell',
      target: 'core.node./:shell.astrale.ai',
      data: { label: 'serves' },
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
  expect(coreDataEntries(node.data)).toEqual([
    {
      key: 'documents.example.dev:class.Document.property.name',
      label: 'name',
      value: 'Welcome',
    },
    {
      key: 'metadata.example.dev:interface.Labelled.property.label',
      label: 'metadata.example.dev:interface.Labelled.property.label',
      value: 'Primary',
    },
    {
      key: 'legacy.example.dev:interface.Labelled.property.label',
      label: 'legacy.example.dev:interface.Labelled.property.label',
      value: 'Legacy',
    },
    { key: 'healthy', label: 'healthy', value: true },
  ])
})
