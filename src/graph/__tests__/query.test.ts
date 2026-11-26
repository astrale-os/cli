import type { QueryDocument } from '@astrale-os/sdk/query'

import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'

import { prepareQuery, prepareQueryDocument, readQueryDocument } from '../query'

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

describe('prepareQueryDocument', () => {
  test('uses natural order for a description-only class, including on resume', async () => {
    const input = { sources: [], search: 'audit', class: '/:notes.example:class.Note' }
    const document = prepareQueryDocument(input)!.document
    if (!('list' in document)) throw new Error('expected a list')
    const { orderBy: _rank, ...list } = document.list
    const requests: unknown[] = []
    for (const cursor of [undefined, 'continuation']) {
      const details: Record<string, string> =
        cursor === undefined
          ? {
              phase: 'plan',
              issue: 'QUERY_PROPERTY_FAMILY',
              path: '/document/list/orderBy/0/property',
            }
          : { phase: 'plan', issue: 'QUERY_CURSOR_INVALID' }
      const refusal = new ResponseError(
        1003,
        'Query input invalid',
        {
          source: issuer.accept('https://instance.test'),
          id: 'query',
        },
        { code: 'QUERY_INPUT_INVALID', details },
      )
      const read = async (request: QueryDocument) => {
        requests.push(request)
        if (request === document) throw refusal
        return 'page'
      }
      await expect(readQueryDocument(document, { ...input, cursor }, read)).resolves.toBe('page')
      expect(requests.splice(0)).toEqual([document, { ...document, list }])
      await expect(readQueryDocument(document, { cursor }, read)).rejects.toBe(refusal)
      expect(requests.splice(0)).toEqual([document])
    }
    const denied = new Error('Access denied')
    await expect(
      readQueryDocument(document, input, async () => {
        requests.push(document)
        throw denied
      }),
    ).rejects.toBe(denied)
    expect(requests).toEqual([document])
  })

  test('includes Nodes with only the standard description when no class is supplied', () => {
    expect(prepareQueryDocument({ sources: [], search: 'audit' })?.document).toMatchObject({
      list: {
        nodes: ['kernel.astrale.ai:class.Named', 'kernel.astrale.ai:class.Descriptable'],
        orderBy: [{ property: 'kernel.astrale.ai:class.Named.property.name', missing: 'last' }],
      },
    })
  })

  test('a class-scoped name and description search resumes like its raw document', () => {
    const direct = prepareQueryDocument({
      sources: [],
      search: 'elo mar',
      class: NOTE,
      cursor: 'resume',
      limit: '7',
    })!
    expect(direct.document).toMatchObject({
      list: {
        nodes: ['notes.example.dev:class.Note'],
        where: {
          op: 'search',
          properties: [
            'kernel.astrale.ai:class.Named.property.name',
            'kernel.astrale.ai:class.Descriptable.property.description',
          ],
          text: 'elo mar',
        },
        orderBy: [{ relevance: 'elo mar', missing: 'last' }],
      },
    })
    expect(direct.paging).toEqual({ sizes: [{ at: [], size: 7 }], after: 'resume' })
    expect(
      prepareQueryDocument({ sources: [], ast: direct.document, limit: '7', cursor: 'resume' }),
    ).toEqual(direct)
    expect(prepareQueryDocument({ sources: [NOTE] })).toBeUndefined()
    expect(() => prepareQueryDocument({ sources: [NOTE], search: 'elo' })).toThrow()
    expect(() =>
      prepareQueryDocument({ sources: [], search: 'elo', ast: direct.document }),
    ).toThrow()
    expect(() =>
      prepareQueryDocument({
        sources: [],
        ast: { query: 'astrale.query/7', count: {} },
        limit: '7',
      }),
    ).toThrow()
  })
})
