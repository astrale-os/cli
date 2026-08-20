import type { StudioCore, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { buildCoreGraph } from './core-view'

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
  expect(graph.edges).toHaveLength(1)
})
