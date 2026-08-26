import { describe, expect, test } from 'bun:test'

import type { IrClass, IrFunction, SchemaIR } from '../../shared/types'

import { diffSchemas, structuralStatusOf } from './diff'

const callable = (returnsType = 'string'): IrFunction => ({
  name: 'inspect',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { mode: 'value', schema: { type: returnsType } },
  auth: 'authenticated',
})

const schema = (functions: SchemaIR['functions']): SchemaIR => ({
  version: 'v1',
  format: 'astrale.dsl',
  domain: 'example.test',
  classes: {},
  importsByKey: {},
  importedClassesByKey: {},
  functions,
  views: {},
  policies: {},
  dependencies: [],
  core: {},
})

const withClass = (member: IrClass): SchemaIR => ({
  ...schema({}),
  classes: { [member.name]: member },
})

describe('canonical standalone Function diffs', () => {
  test('reports additions and removals without claiming Runtime compatibility', () => {
    const empty = schema({})
    const populated = schema({ inspect: callable() })
    expect(diffSchemas(empty, populated)).toEqual([{ kind: 'function-added', target: 'inspect' }])
    const removed = diffSchemas(populated, empty)
    expect(removed).toEqual([{ kind: 'function-removed', target: 'inspect' }])
    expect(structuralStatusOf(removed)).toBe('changed')
  })

  test('detects a standalone Function signature change', () => {
    expect(
      diffSchemas(schema({ inspect: callable() }), schema({ inspect: callable('number') })),
    ).toEqual([{ kind: 'function-signature-changed', target: 'inspect' }])
  })

  test('detects auth and output-mode changes in callable contracts', () => {
    const before = callable()
    const after: IrFunction = {
      ...before,
      auth: 'authorized',
      output: { mode: 'stream', item: { type: 'string' } },
    }

    expect(diffSchemas(schema({ inspect: before }), schema({ inspect: after }))).toEqual([
      { kind: 'function-signature-changed', target: 'inspect' },
    ])
  })

  test('uses canonical required membership and compares complete value schemas', () => {
    const member = (required: string[], minLength: number): IrClass => ({
      type: 'node',
      name: 'Person',
      origin: 'example.test',
      ref: { origin: 'example.test', kind: 'class', name: 'Person' },
      properties: { name: { type: 'string', minLength } },
      required,
      methods: {},
    })

    expect(diffSchemas(withClass(member([], 1)), withClass(member(['name'], 2)))).toEqual([
      {
        kind: 'prop-schema-changed',
        target: 'Person.name',
        detail: 'value constraints changed',
      },
      {
        kind: 'prop-required-changed',
        target: 'Person.name',
        detail: 'optional → required',
      },
    ])
  })

  test('tracks canonical views, policies, dependencies, topology, and Core', () => {
    const before: SchemaIR = {
      ...withClass({
        type: 'edge',
        name: 'owns',
        origin: 'example.test',
        ref: { origin: 'example.test', kind: 'class', name: 'owns' },
        properties: {},
        required: [],
        methods: {},
        orientation: 'directed',
        endpoints: [],
      }),
      views: { home: { name: 'home', target: { kind: 'domain' } } },
      policies: { canRead: { anyOf: [] } },
      dependencies: [{ origin: 'kernel.astrale.ai', revision: 'sha256:one' }],
      core: { nodes: {}, edges: [] },
    }
    const after: SchemaIR = {
      ...before,
      classes: {
        owns: { ...before.classes.owns, orientation: 'undirected' },
      },
      views: {
        home: {
          ...before.views.home,
          target: {
            kind: 'definition',
            definitions: [{ origin: 'example.test', kind: 'class', name: 'owns' }],
          },
        },
      },
      policies: { canRead: { anyOf: [{ name: 'owner' }] } },
      dependencies: [{ origin: 'kernel.astrale.ai', revision: 'sha256:two' }],
      core: { nodes: { root: {} }, edges: [] },
    }

    expect(diffSchemas(before, after).map((change) => change.kind)).toEqual([
      'edge-contract-changed',
      'view-changed',
      'policy-changed',
      'dependency-changed',
      'core-changed',
    ])
  })
})
