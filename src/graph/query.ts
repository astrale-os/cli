import type {
  QueryAST as QueryASTValue,
  QueryDefinitionRef,
  QueryDirection,
} from '@astrale-os/kernel-core/graph/query'

import { ClassPath } from '@astrale-os/kernel-core/graph/class'
import { Query, QueryAST } from '@astrale-os/kernel-core/graph/query'
import { Path } from '@astrale-os/kernel-core/path'

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
  readonly cursor?: string
}

const DEFAULT_LIMIT = 100

/** Admit canonical Query V5 or author the intentionally small Path/Definition/one-edge subset. */
export function prepareQuery(input: QueryCommandInput): PreparedQuery {
  if (input.ast !== undefined) {
    if (
      input.sources.length > 0 ||
      input.definition !== undefined ||
      input.edge !== undefined ||
      input.direction !== undefined ||
      input.limit !== undefined
    ) {
      throw new TypeError(
        '--ast/--file cannot be combined with sources, --definition, --edge, --direction, or --limit',
      )
    }
    return withCursor(QueryAST.decode(input.ast), input.cursor)
  }

  if (input.sources.length === 0 && input.definition === undefined) {
    throw new TypeError(
      'query requires a Path source, --definition, or a canonical Query V5 document',
    )
  }
  if (input.direction !== undefined && input.edge === undefined) {
    throw new TypeError('--direction requires --edge')
  }

  const paths = input.sources.map((source) => Path.parse(source))
  const definition = input.definition === undefined ? undefined : definitionRef(input.definition)
  const limit = positiveInteger(input.limit, '--limit', DEFAULT_LIMIT)
  let query =
    paths.length > 0
      ? Query.source({
          paths: paths as [Path, ...Path[]],
          ...(definition === undefined ? {} : { definitions: [definition] }),
        })
      : Query.source({ definitions: [definition!] })
  if (input.edge !== undefined) {
    query = query.expand({
      edges: [ClassPath.parse(input.edge)],
      direction: input.direction ?? 'outgoing',
    })
  }
  return withCursor(query.select({ limit }), input.cursor)
}

function definitionRef(input: string): QueryDefinitionRef {
  const path = Path.parse(input)
  const step = path.ast.steps[0]
  if (
    path.ast.anchor.kind !== 'domain' ||
    path.ast.steps.length !== 1 ||
    step?.kind !== 'member' ||
    (step.member.kind !== 'class' && step.member.kind !== 'interface')
  ) {
    throw new TypeError('--definition must be one canonical Class or Interface Path')
  }
  return Object.freeze({
    origin: path.ast.anchor.origin,
    kind: step.member.kind,
    name: step.member.name,
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

function withCursor(ast: QueryASTValue, cursor: string | undefined): PreparedQuery {
  return Object.freeze({ ast, ...(cursor === undefined ? {} : { cursor }) })
}
