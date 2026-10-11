import type { MutationAST as MutationASTValue, MutationInput } from '@astrale-os/sdk/mutation'

import { MutationAST } from '@astrale-os/sdk/mutation'

/** Admit the canonical document or Core's exact rich authoring input at the CLI JSON boundary. */
export function prepareMutation(input: unknown): MutationASTValue {
  const record =
    input !== null && typeof input === 'object' && !Array.isArray(input) ? input : undefined
  if (record !== undefined && (Object.hasOwn(record, 'format') || Object.hasOwn(record, 'version')))
    return MutationAST.decode(record)
  if (!Array.isArray((record as { readonly operations?: unknown } | undefined)?.operations)) {
    throw new TypeError(
      'A Mutation authors { preconditions?, operations } or is a canonical astrale.graph.mutation/v3 document.',
    )
  }
  return MutationAST.create(record as MutationInput)
}
