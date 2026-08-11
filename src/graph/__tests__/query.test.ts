import { describe, expect, test } from 'bun:test'

import { prepareQuery } from '../query'

describe('prepareQuery', () => {
  /** @evidence TEST-CLI-GRAPH-AUTHORS-QUERY-V3 */
  test('authors the supported Path and exact-edge subset as canonical Query V3', () => {
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
        version: 'v3',
        source: {
          terms: [{ kind: 'path', path: '/:notes.example.dev:class.Note' }],
          binding: 'n0',
        },
        steps: [
          {
            op: 'expand',
            from: 'n0',
            edges: ['/:notes.example.dev:class.references'],
            direction: 'incoming',
            bindings: { edge: 'e0', node: 'n1' },
          },
        ],
        select: { kind: 'graph', binding: 'n1', limit: 25 },
      },
      cursor: 'next-page',
    })
  })

  /** @evidence TEST-CLI-GRAPH-AUTHORS-DEFINITION-QUERY */
  test('authors an exact Definition source without backend query text', () => {
    const prepared = prepareQuery({
      sources: [],
      definition: '/:issues.astrale.ai:class.Issue',
      limit: '201',
    })

    expect(JSON.parse(JSON.stringify(prepared.ast))).toEqual({
      format: 'astrale.graph.query',
      version: 'v3',
      source: {
        terms: [
          {
            kind: 'definition',
            definition: { origin: 'issues.astrale.ai', kind: 'class', name: 'Issue' },
          },
        ],
        binding: 'n0',
      },
      steps: [],
      select: { kind: 'graph', binding: 'n0', limit: 201 },
    })
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
    ).toThrow('--definition must be one canonical Class or Interface Path')
  })
})
