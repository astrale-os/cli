import type { MutationAST } from '@astrale-os/sdk/mutation'
import type { QueryAST, QueryDirection } from '@astrale-os/sdk/query'

/** Untrusted CLI fields used to author or admit one exact Query V5 request. */
export interface QueryCommandInput {
  readonly sources: readonly string[]
  readonly definition?: string
  readonly ast?: unknown
  readonly edge?: string
  readonly direction?: QueryDirection
  readonly limit?: string
  readonly cursor?: string
}

/** Canonical query plus the caller-bound continuation token kept outside the AST. */
export interface PreparedQuery {
  readonly ast: QueryAST
  readonly cursor?: string
}

/** Admit canonical Query V5 or author its supported Path/Definition/one-edge CLI subset. */
export function prepareQuery(input: QueryCommandInput): PreparedQuery

/** Admit canonical Mutation V2 or its exact authoring input; legacy PatchData is rejected. */
export function prepareMutation(input: unknown): MutationAST

/** Return the user-facing leaf of one exact qualified Property key. */
export function unqualifyProperty(key: string): string

/** Read one property by exact key first, then by its qualified leaf name. */
export function nodeProperty(
  node: { readonly props: Readonly<Record<string, unknown>> } | null | undefined,
  name: string,
): unknown
