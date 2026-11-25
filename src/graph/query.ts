import type { ClassRef } from '@astrale-os/sdk/graph/class'
import type {
  NodeQueryBuilder,
  QueryDocument,
  QueryAST as QueryASTValue,
  QueryDirection,
  QueryNodeInput,
} from '@astrale-os/sdk/query'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { Path } from '@astrale-os/sdk/graph/path'
import { Query, QueryAST } from '@astrale-os/sdk/query'

export interface QueryCommandInput {
  readonly search?: string
  readonly sources: readonly string[]
  readonly class?: string
  readonly ast?: unknown
  readonly edge?: string
  readonly direction?: QueryDirection
  readonly limit?: string
  readonly cursor?: string
}

interface PreparedQuery {
  readonly ast: QueryASTValue
  readonly page: Readonly<{ readonly size: number; readonly after?: string }>
}

interface PreparedDocument {
  readonly document: QueryDocument
  readonly paging: {
    readonly sizes?: readonly { readonly at: readonly string[]; readonly size: number }[]
    readonly after?: string
  }
}

const DEFAULT_LIMIT = 100

/** The Kernel admits the v7 document against its live Registry. Source and Edge arguments
 * belong to the V6 builder. A text search lists Named Nodes across its concrete Classes. */
export function prepareQueryDocument(input: QueryCommandInput): PreparedDocument | undefined {
  const ast = input.ast
  const v7 =
    ast !== null && typeof ast === 'object' && 'query' in ast && ast.query === 'astrale.query/7'
  if (input.search === undefined && !v7) return undefined
  if (
    input.sources.length ||
    input.direction !== undefined ||
    input.edge !== undefined ||
    (input.ast !== undefined && (input.search !== undefined || input.class !== undefined))
  )
    throw new TypeError('Use a v7 document alone or --search with an optional --class.')
  const document = v7 ? (ast as QueryDocument) : namedSearch(input.search!, input.class)
  if (!('list' in document) && (input.limit !== undefined || input.cursor !== undefined))
    throw new TypeError('--limit and --cursor require a list')
  if (input.cursor === '') throw new TypeError('--cursor must contain a continuation')
  const size = positiveInteger(input.limit, '--limit', DEFAULT_LIMIT)
  const sizes =
    'list' in document && (input.limit !== undefined || input.search !== undefined)
      ? [{ at: [], size }]
      : undefined
  return {
    document,
    paging: { ...(sizes && { sizes }), ...(input.cursor && { after: input.cursor }) },
  }
}

function namedSearch(text: string, source?: string): QueryDocument {
  const property = 'kernel.astrale.ai:class.Named.property.name'
  const of =
    source === undefined
      ? 'kernel.astrale.ai:class.Named'
      : ClassKey.of(classReference(source, '--class'))
  return {
    query: 'astrale.query/7',
    list: {
      nodes: [of],
      where: { op: 'search', properties: [property], text },
      orderBy: [{ property, relevance: text, missing: 'last' }],
      select: 'value',
    },
  }
}

/** Admit canonical Query V6 or author the intentionally small Path/Class/one-edge subset. */
export function prepareQuery(input: QueryCommandInput): PreparedQuery {
  const limit = positiveInteger(input.limit, '--limit', DEFAULT_LIMIT)
  if (input.ast !== undefined) {
    if (
      input.sources.length > 0 ||
      input.class !== undefined ||
      input.edge !== undefined ||
      input.direction !== undefined
    ) {
      throw new TypeError(
        '--ast/--file cannot be combined with sources, --class, --edge, or --direction',
      )
    }
    return withPage(QueryAST.decode(input.ast), limit, input.cursor)
  }

  if (input.sources.length === 0 && input.class === undefined) {
    throw new TypeError('query requires a Path source, --class, or a canonical Query V6 document')
  }
  if (input.direction !== undefined && input.edge === undefined) {
    throw new TypeError('--direction requires --edge')
  }

  const paths = input.sources.map((source) => Path.parse(source))
  const selectedClass =
    input.class === undefined ? undefined : classReference(input.class, '--class')
  const nodes = selectedClass === undefined ? paths : [...paths, selectedClass]
  const query: NodeQueryBuilder<unknown> = Query.from({
    nodes: nodes as [QueryNodeInput, ...QueryNodeInput[]],
  })
  const ast =
    input.edge === undefined
      ? query.select({ kind: 'graph', binding: query.node })
      : expanded(query, input.edge, input.direction)
  return withPage(ast, limit, input.cursor)
}

function expanded(
  query: NodeQueryBuilder<unknown>,
  edge: string,
  direction: QueryDirection | undefined,
): QueryASTValue {
  const result = query.expand({
    via: [classReference(edge, '--edge')],
    direction: direction ?? 'outgoing',
  })
  return result.select({ kind: 'graph', binding: result.node })
}

function positiveInteger(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback
  if (!/^\d+$/.test(raw)) throw new TypeError(`${name} must be a positive integer`)
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value
}

function withPage(ast: QueryASTValue, size: number, cursor: string | undefined): PreparedQuery {
  return Object.freeze({
    ast,
    page: Object.freeze({ size, ...(cursor === undefined ? {} : { after: cursor }) }),
  })
}

/** Admit one canonical Domain-rooted Class Path into its DSL coordinate. */
function classReference(input: string, label: string): ClassRef {
  const path = Path.parse(input)
  const step = path.ast.steps[0]
  if (
    path.ast.anchor.kind !== 'domain' ||
    path.ast.steps.length !== 1 ||
    step?.kind !== 'projection' ||
    step.projection.kind !== 'class'
  ) {
    throw new TypeError(`${label} must be one canonical Class Path`)
  }
  return ClassKey.ref(
    ClassKey.of({
      origin: path.ast.anchor.origin,
      kind: 'class',
      name: step.projection.name,
    }),
  )
}
