import type { ClassKey, ClassRef } from '@astrale-os/sdk/graph/class'
import type { MutationAST } from '@astrale-os/sdk/mutation'
import type { QueryAST, QueryDirection } from '@astrale-os/sdk/query'

/** Admit one canonical Domain-rooted Class Path into its DSL coordinate. */
export function classReference(input: string, label: string): ClassRef

/** Admit one canonical Domain-rooted Class Path into its exact string identity. */
export function classKey(input: string, label: string): ClassKey

/** Untrusted CLI fields used to author or admit one exact Query V6 request. */
export interface QueryCommandInput {
  readonly sources: readonly string[]
  readonly class?: string
  readonly ast?: unknown
  readonly edge?: string
  readonly direction?: QueryDirection
  readonly limit?: string
  readonly cursor?: string
}

/** Canonical query plus caller-bound pagination kept outside the AST. */
export interface PreparedQuery {
  readonly ast: QueryAST
  readonly page: Readonly<{ readonly size: number; readonly after?: string }>
}

/** Admit canonical Query V6 or author its supported Path/Class/one-edge CLI subset. */
export function prepareQuery(input: QueryCommandInput): PreparedQuery

/** Admit canonical Mutation V3 or its exact authoring input; legacy PatchData is rejected. */
export function prepareMutation(input: unknown): MutationAST

/** Return the user-facing leaf of one exact qualified Property key. */
export function unqualifyProperty(key: string): string

/** Read one property by exact key first, then by its qualified leaf name. */
export function nodeProperty(
  node: { readonly props: Readonly<Record<string, unknown>> } | null | undefined,
  name: string,
): unknown
