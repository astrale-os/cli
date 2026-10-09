import type { IrClass, IrFunction, JsonSchema, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { buildFunctionsModel } from '@/lib/functions'

import { functionGraph, functionGraphKey } from './function-graph'

const issue: IrClass = {
  type: 'node',
  name: 'Issue',
  origin: 'example.test',
  ref: { origin: 'example.test', kind: 'class', name: 'Issue' },
  properties: {},
  methods: {},
}

function nodePath(name: string): JsonSchema {
  return {
    $ref: 'https://schemas.astrale.ai/graph/1/node-path',
    'x-astrale-path': {
      target: 'node',
      cardinality: 'one',
      accepts: [{ origin: 'example.test', kind: 'class', name }],
    },
  }
}

const triage: IrFunction = {
  name: 'triage',
  input: { type: 'object', properties: { issue: nodePath('Issue') } },
  output: { mode: 'value', schema: { type: 'string' } },
}

const health: IrFunction = {
  name: 'health',
  input: { type: 'object', properties: {} },
  output: { mode: 'value', schema: { type: 'string' } },
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
      functions: { triage, health },
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
    extractedAt: '2026-09-21T00:00:00.000Z',
  } satisfies StudioSchemaBundle
}

test('every function becomes a node, wired to the classes it works on', () => {
  const source = bundle()
  const { nodes, edges } = functionGraph(buildFunctionsModel(source), source, new Set(), {})

  expect(nodes.map((node) => node.id)).toEqual(['function.triage', 'function.health'])
  expect(nodes.every((node) => node.type === 'functionNode')).toBe(true)
  // `health` names no class — it still gets a node, it just hangs off nothing
  expect(edges).toEqual([
    expect.objectContaining({ source: 'function.triage', target: 'class.Issue' }),
  ])
})

test('a folded module takes the binding, so the edge never points at a hidden class', () => {
  const source = bundle()
  const { edges } = functionGraph(buildFunctionsModel(source), source, new Set(['tracker']), {})

  expect(edges[0]?.target).toBe('grp-tracker')
})

test('hiding the class drops the binding, not the function', () => {
  const source = bundle()
  const { nodes, edges } = functionGraph(buildFunctionsModel(source), source, new Set(), {
    'class.Issue': true,
  })

  expect(nodes.map((node) => node.id)).toEqual(['function.triage', 'function.health'])
  expect(edges).toEqual([])
})

test('the rebuild key moves when a binding does — and only then', () => {
  const source = bundle()
  const base = functionGraphKey(buildFunctionsModel(source))

  expect(functionGraphKey(buildFunctionsModel(bundle()))).toBe(base)

  const unbound = bundle()
  unbound.ir!.functions.triage = { ...triage, input: { type: 'object', properties: {} } }
  expect(functionGraphKey(buildFunctionsModel(unbound))).not.toBe(base)
})
