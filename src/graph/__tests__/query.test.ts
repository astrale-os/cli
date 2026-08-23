import { describe, expect, test } from 'bun:test'

import { prepareQuery } from '../query'

describe('prepareQuery', () => {
  /** @evidence TEST-CLI-GRAPH-AUTHORS-QUERY-V6 */
  test('authors the supported Path and exact-edge subset as canonical Query V6', () => {
    const prepared = prepareQuery({
      sources: ['/:notes.example.dev:class.Note'],
      edge: '/:notes.example.dev:class.references',
      direction: 'incoming',
      limit: '25',
      cursor: 'next-page',
    })

    expect(JSON.parse(JSON.stringify(prepared))).toEqual({
      ast: {
        format: 'astrale.graph.query',
        version: 'v6',
        source: {
          kind: 'node',
          terms: [{ kind: 'path', path: '/:notes.example.dev:class.Note' }],
          binding: 'n0',
        },
        steps: [
          {
            op: 'expand',
            from: 'n0',
            via: [{ origin: 'notes.example.dev', kind: 'class', name: 'references' }],
            direction: 'incoming',
            bindings: { edge: 'e0', node: 'n1' },
          },
        ],
        select: { kind: 'graph', binding: 'n1' },
      },
      page: { size: 25, after: 'next-page' },
    })
  })

  /** @evidence TEST-CLI-GRAPH-AUTHORS-DEFINITION-QUERY */
  test('authors an exact Class source without backend query text', () => {
    const prepared = prepareQuery({
      sources: [],
      definition: '/:issues.astrale.ai:class.Issue',
      limit: '201',
    })

    expect(JSON.parse(JSON.stringify(prepared.ast))).toEqual({
      format: 'astrale.graph.query',
      version: 'v6',
      source: {
        kind: 'node',
        terms: [
          {
            kind: 'class',
            class: { origin: 'issues.astrale.ai', kind: 'class', name: 'Issue' },
          },
        ],
        binding: 'n0',
      },
      steps: [],
      select: { kind: 'graph', binding: 'n0' },
    })
    expect(prepared.page).toEqual({ size: 201 })
  })

  test('unions positional Paths and one Class source in authored order', () => {
    const prepared = prepareQuery({
      sources: ['@note'],
      definition: '/:issues.astrale.ai:class.Issue',
    })

    expect(JSON.parse(JSON.stringify(prepared.ast.source))).toEqual({
      kind: 'node',
      terms: [
        { kind: 'path', path: '@note' },
        {
          kind: 'class',
          class: { origin: 'issues.astrale.ai', kind: 'class', name: 'Issue' },
        },
      ],
      binding: 'n0',
    })
  })

  /** @evidence TEST-CLI-GRAPH-ADMITS-QUERY-V6-ORDERING */
  test('admits one exact Property-ordered Query V6 document', () => {
    const ast = {
      format: 'astrale.graph.query',
      version: 'v6',
      source: {
        kind: 'node',
        terms: [
          {
            kind: 'class',
            class: { origin: 'notes.example.dev', kind: 'class', name: 'Note' },
          },
        ],
        binding: 'n0',
      },
      steps: [],
      select: {
        kind: 'graph',
        binding: 'n0',
        order: {
          property: 'notes.example.dev:class.Note.property.sequence',
          direction: 'desc',
          unranked: 'last',
        },
      },
    }

    const prepared = prepareQuery({ sources: [], ast, limit: '3' })
    expect(JSON.parse(JSON.stringify(prepared.ast))).toEqual(ast)
    expect(prepared.page).toEqual({ size: 3 })
  })

  /** @evidence TEST-CLI-GRAPH-ADMITS-QUERY-V6-PROJECTIONS */
  test('admits exact Node and Edge projection profiles in Query V6 documents', () => {
    const source = {
      terms: [{ kind: 'path', path: '/:notes.example.dev:class.Note' }],
      binding: 'n0',
      kind: 'node',
    } as const
    const node = {
      format: 'astrale.graph.query',
      version: 'v6',
      source,
      steps: [],
      select: { kind: 'nodes', binding: 'n0', projection: { kind: 'reference' } },
    }
    const edge = {
      format: 'astrale.graph.query',
      version: 'v6',
      source,
      steps: [
        {
          op: 'expand',
          from: 'n0',
          via: [{ origin: 'notes.example.dev', kind: 'class', name: 'references' }],
          direction: 'outgoing',
          bindings: { edge: 'e0', node: 'n1' },
        },
      ],
      select: {
        kind: 'edges',
        binding: 'e0',
        projection: { edge: 'value', source: 'reference', target: 'value' },
      },
    }

    expect(
      JSON.parse(JSON.stringify(prepareQuery({ sources: [], ast: node, limit: '5' }).ast)),
    ).toEqual(node)
    expect(
      JSON.parse(JSON.stringify(prepareQuery({ sources: [], ast: edge, limit: '5' }).ast)),
    ).toEqual(edge)
  })

  /** @evidence TEST-CLI-GRAPH-REJECTS-LEGACY-QUERY */
  test('rejects V1 queries and unsupported combinations locally', () => {
    expect(() => prepareQuery({ sources: [], ast: { version: 1, from: ['/'] } })).toThrow()
    expect(() =>
      prepareQuery({ sources: ['/:notes.example.dev:class.Note'], direction: 'incident' }),
    ).toThrow('--direction requires --edge')
    expect(() =>
      prepareQuery({ sources: ['/:notes.example.dev:class.Note'], limit: 'all' }),
    ).toThrow('--limit must be a positive integer')
    expect(() =>
      prepareQuery({ sources: [], definition: '/:notes.example.dev:view.note' }),
    ).toThrow('--definition must be one canonical Class Path')
  })
})
