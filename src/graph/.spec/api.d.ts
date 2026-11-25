import type { MutationAST } from '@astrale-os/sdk/mutation'
import type { QueryAST, QueryDirection, QueryDocument } from '@astrale-os/sdk/query'

/** Untrusted CLI fields used to author or admit one exact Query V6 request. */
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

/** Canonical query plus caller-bound pagination kept outside the AST. */
export interface PreparedQuery {
  readonly ast: QueryAST
  readonly page: Readonly<{ readonly size: number; readonly after?: string }>
}

/** Admit canonical Query V6 or author its supported Path/Class/one-edge CLI subset. */
export function prepareQuery(input: QueryCommandInput): PreparedQuery

/** Admit canonical Mutation V3 or its exact authoring input. */
export function prepareMutation(input: unknown): MutationAST

export interface PreparedDocument {
  readonly document: QueryDocument
  readonly paging: {
    readonly sizes?: readonly { readonly at: readonly string[]; readonly size: number }[]
    readonly after?: string
  }
}

/** The v7 list with its caller's delivery size and opaque continuation. */
export function prepareQueryDocument(input: QueryCommandInput): PreparedDocument | undefined
