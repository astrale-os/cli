import { describe, expect, test } from 'bun:test'

import { prepareQuery } from '../query'

const NOTE = '/:notes.example.dev:class.Note'
const ISSUE = { origin: 'issues.astrale.ai', kind: 'class', name: 'Issue' }
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

describe('prepareQuery', () => {
  /** @evidence TEST-CLI-GRAPH-AUTHORS-QUERY-V6 */
  test('authors the supported Path and exact-edge subset as canonical Query V6', () => {
    const prepared = prepareQuery({
      sources: [NOTE],
      edge: '/:notes.example.dev:class.references',
      direction: 'incoming',
      limit: '25',
      cursor: 'next-page',
    })

    expect(plain(prepared)).toEqual({
      ast: {
        format: 'astrale.graph.query',
        version: 'v6',
        source: { kind: 'node', terms: [{ kind: 'path', path: NOTE }], binding: 'n0' },
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

  /** @evidence TEST-CLI-GRAPH-AUTHORS-CLASS-QUERY */
  test('authors an exact Class source, after positional Paths, without backend query text', () => {
    expect(plain(prepareQuery({ sources: [], class: '/:issues.astrale.ai:class.Issue' }))).toEqual({
      ast: {
        format: 'astrale.graph.query',
        version: 'v6',
        source: { kind: 'node', terms: [{ kind: 'class', class: ISSUE }], binding: 'n0' },
        steps: [],
        select: { kind: 'graph', binding: 'n0' },
      },
      page: { size: 100 },
    })
    const union = prepareQuery({ sources: ['@note'], class: '/:issues.astrale.ai:class.Issue' })
    expect(plain(union.ast.source)).toMatchObject({
      terms: [
        { kind: 'path', path: '@note' },
        { kind: 'class', class: ISSUE },
      ],
    })
  })

  /** @evidence TEST-CLI-GRAPH-ADMITS-QUERY-V6-DOCUMENT */
  test('admits one canonical Query V6 document unchanged, with its own page size', () => {
    const ast = {
      format: 'astrale.graph.query',
      version: 'v6',
      source: { kind: 'node', terms: [{ kind: 'path', path: NOTE }], binding: 'n0' },
      steps: [],
      select: {
        kind: 'nodes',
        binding: 'n0',
        projection: { kind: 'reference' },
        order: {
          property: 'notes.example.dev:class.Note.property.sequence',
          direction: 'desc',
          unranked: 'last',
        },
      },
    }
    const prepared = prepareQuery({ sources: [], ast, limit: '3' })
    expect(plain(prepared)).toEqual({ ast, page: { size: 3 } })
  })

  /** @evidence TEST-CLI-GRAPH-REJECTS-LEGACY-QUERY */
  test('rejects V1 queries and unsupported combinations locally', () => {
    expect(() => prepareQuery({ sources: [], ast: { version: 1, from: ['/'] } })).toThrow()
    expect(() => prepareQuery({ sources: [NOTE], direction: 'incident' })).toThrow(
      '--direction requires --edge',
    )
    expect(() => prepareQuery({ sources: [NOTE], limit: 'all' })).toThrow(
      '--limit must be a positive integer',
    )
    expect(() => prepareQuery({ sources: [], ast: {}, class: NOTE })).toThrow(
      '--ast/--file cannot be combined with sources, --class, --edge, or --direction',
    )
    expect(() => prepareQuery({ sources: [], class: '/:notes.example.dev:view.note' })).toThrow(
      '--class must be one canonical Class Path',
    )
  })
})
