import type { StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { buildFunctionsModel } from '@/lib/functions'

import { bundle, classRef, nodeClass, nodePath } from './__tests__/fixture'
import { functionGraph, functionGraphKey } from './function-graph'

function source(bound = true): StudioSchemaBundle {
  const value = bundle({ Issue: nodeClass('Issue') })
  const output = { mode: 'value', schema: { type: 'string' } } as const
  value.ir!.functions = {
    triage: {
      name: 'triage',
      input: {
        type: 'object',
        properties: bound ? { issue: nodePath(classRef('local.example.dev', 'Issue')) } : {},
      },
      output,
    },
    health: { name: 'health', input: { type: 'object', properties: {} }, output },
  }
  value.overlay.sourceSpans['class.Issue'] = {
    file: 'schema/tracker/issue.ts',
    startLine: 1,
    endLine: 3,
  }
  return value
}

const graph = (collapsed: string[] = [], hidden: Record<string, true> = {}) =>
  functionGraph(buildFunctionsModel(source()), source(), new Set(collapsed), hidden)

test('every function is a node, wired to the classes it works on', () => {
  const { nodes, edges } = graph()
  expect(nodes.map((node) => node.id)).toEqual(['function.triage', 'function.health'])
  // `health` names no class: it still gets a node, it just hangs off nothing
  expect(edges).toEqual([
    expect.objectContaining({ source: 'function.triage', target: 'class.Issue' }),
  ])
})

test('a folded module takes the binding; a hidden class drops it, never the function', () => {
  expect(graph(['tracker']).edges[0]?.target).toBe('grp-tracker')
  const hidden = graph([], { 'class.Issue': true })
  expect(hidden.nodes).toHaveLength(2)
  expect(hidden.edges).toEqual([])
})

test('the rebuild key moves when a binding does, and only then', () => {
  const base = functionGraphKey(buildFunctionsModel(source()))
  expect(functionGraphKey(buildFunctionsModel(source()))).toBe(base)
  expect(functionGraphKey(buildFunctionsModel(source(false)))).not.toBe(base)
})
