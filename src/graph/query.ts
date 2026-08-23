import type {
  QueryAST as QueryASTValue,
  QueryDirection,
  QueryNodeClassInput,
  QueryNodeInput,
} from '@astrale-os/sdk/query'

import { Path } from '@astrale-os/sdk/graph/path'
import { Query, QueryAST } from '@astrale-os/sdk/query'

export interface QueryCommandInput {
  readonly sources: readonly string[]
  readonly definition?: string
  readonly ast?: unknown
  readonly edge?: string
  readonly direction?: QueryDirection
  readonly limit?: string
  readonly cursor?: string
}

export interface PreparedQuery {
  readonly ast: QueryASTValue
  readonly page: Readonly<{ readonly size: number; readonly after?: string }>
}

const DEFAULT_LIMIT = 100

/** Admit canonical Query V6 or author the intentionally small Path/Definition/one-edge subset. */
export function prepareQuery(input: QueryCommandInput): PreparedQuery {
  const limit = positiveInteger(input.limit, '--limit', DEFAULT_LIMIT)
  if (input.ast !== undefined) {
    if (
      input.sources.length > 0 ||
      input.definition !== undefined ||
      input.edge !== undefined ||
      input.direction !== undefined
    ) {
      throw new TypeError(
        '--ast/--file cannot be combined with sources, --definition, --edge, or --direction',
      )
    }
    return withPage(QueryAST.decode(input.ast), limit, input.cursor)
  }

  if (input.sources.length === 0 && input.definition === undefined) {
    throw new TypeError(
      'query requires a Path source, --definition, or a canonical Query V6 document',
    )
  }
  if (input.direction !== undefined && input.edge === undefined) {
    throw new TypeError('--direction requires --edge')
  }

  const paths = input.sources.map((source) => Path.parse(source))
  const definition = input.definition === undefined ? undefined : definitionRef(input.definition)
  const nodes = definition === undefined ? paths : [...paths, definition]
  const query = Query.from({ nodes: nodes as [QueryNodeInput, ...QueryNodeInput[]] })
  const ast =
    input.edge === undefined
      ? query.select({ kind: 'graph' })
      : query
          .expand({
            via: [definitionRef(input.edge)],
            direction: input.direction ?? 'outgoing',
          })
          .select({ kind: 'graph' })
  return withPage(ast, limit, input.cursor)
}

function definitionRef(input: string): QueryNodeClassInput {
  const path = Path.parse(input)
  const step = path.ast.steps[0]
  if (
    path.ast.anchor.kind !== 'domain' ||
    path.ast.steps.length !== 1 ||
    step?.kind !== 'projection' ||
    step.projection.kind !== 'class'
  ) {
    throw new TypeError('--definition must be one canonical Class Path')
  }
  return Object.freeze({
    origin: path.ast.anchor.origin,
    kind: step.projection.kind,
    name: step.projection.name,
  })
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
