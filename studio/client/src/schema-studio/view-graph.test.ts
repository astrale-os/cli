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

const board = { slug: 'board', kind: 'spa', mount: '/ui/board', viewFor: 'Issue' } as const
const about = { slug: 'about', kind: 'inline-html' } as const

test('every view becomes a node, bound to the class it renders', () => {
  const source = bundle()
  const model = buildViewsModel(anatomy([board, about]), source)

  const { nodes, edges } = viewGraph(model, source, new Set(), {})

  expect(nodes.map((node) => node.id)).toEqual(['view.board', 'view.about'])
  expect(nodes.every((node) => node.type === 'viewNode')).toBe(true)
  // a standalone view still gets a node — it just hangs off nothing
  expect(edges).toEqual([expect.objectContaining({ source: 'view.board', target: 'class.Issue' })])
})

test('a folded module takes the binding, so the edge never points at a hidden class', () => {
  const source = bundle()
  const model = buildViewsModel(anatomy([board]), source)

  const { edges } = viewGraph(model, source, new Set(['tracker']), {})

  expect(edges[0]?.target).toBe('grp-tracker')
})

test('hiding the bound class drops the binding, not the view', () => {
  const source = bundle()
  const model = buildViewsModel(anatomy([board]), source)

  const { nodes, edges } = viewGraph(model, source, new Set(), { 'class.Issue': true })

  expect(nodes.map((node) => node.id)).toEqual(['view.board'])
  expect(edges).toEqual([])
})

test('the rebuild key moves when a binding does — and only then', () => {
  const source = bundle()
  const base = viewGraphKey(buildViewsModel(anatomy([board]), source))

  expect(viewGraphKey(buildViewsModel(anatomy([board]), source))).toBe(base)
  expect(
    viewGraphKey(buildViewsModel(anatomy([{ ...board, viewFor: undefined }]), source)),
  ).not.toBe(base)
})
