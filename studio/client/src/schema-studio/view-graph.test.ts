import type { DomainAnatomy, IrClass, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { buildViewsModel } from '@/lib/views'

import { viewGraph, viewGraphKey } from './view-graph'

const issue: IrClass = {
  type: 'node',
  name: 'Issue',
  origin: 'example.test',
  ref: { origin: 'example.test', kind: 'class', name: 'Issue' },
  properties: {},
  methods: {},
}

function bundle(): StudioSchemaBundle {
  return {
    domainId: 'example',
    renderFingerprint: 'fixture',
    schemaMode: 'canonical-admitted',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      format: 'astrale.dsl',
      version: 'v1',
      domain: 'example.test',
      classes: { Issue: issue },
      importsByKey: {},
      importedClassesByKey: {},
      functions: {},
      views: {},
      policies: {},
      dependencies: [],
      core: {},
    },
    overlay: {
      handlerLinks: [],
      sourceSpans: {
        'class.Issue': { file: 'schema/tracker/issue.ts', startLine: 1, endLine: 3 },
      },
    },
    extractedAt: '2026-08-23T00:00:00.000Z',
  } satisfies StudioSchemaBundle
}

function anatomy(views: DomainAnatomy['views']): DomainAnatomy {
  return {
    overview: {
      origin: 'example.test',
      adapter: 'astrale',
      requires: [],
      astraleDeps: {},
      schemaDir: 'schema',
    },
    views,
    client: { routes: {}, shell: [], features: [], present: true },
    env: [],
    detectedIntegrations: [],
  } satisfies DomainAnatomy
}

const board = { slug: 'board', kind: 'spa', mount: '/ui/board' } as const
const about = { slug: 'about', kind: 'inline-html' } as const

test('every view becomes a node of its Domain, bound to no class', () => {
  const source = bundle()
  const model = buildViewsModel(anatomy([board, about]), source)

  const { nodes, edges } = viewGraph(model, source)

  expect(nodes.map((node) => node.id)).toEqual(['view.board', 'view.about'])
  expect(nodes.every((node) => node.type === 'viewNode')).toBe(true)
  expect(edges).toEqual([])
})

test('the rebuild key moves when the declared views do, and only then', () => {
  const source = bundle()
  const base = viewGraphKey(buildViewsModel(anatomy([board]), source))

  expect(viewGraphKey(buildViewsModel(anatomy([board]), source))).toBe(base)
  expect(viewGraphKey(buildViewsModel(anatomy([board, about]), source))).not.toBe(base)
})
