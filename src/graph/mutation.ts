import type { MutationAST as MutationASTValue, MutationInput } from '@astrale-os/sdk/mutation'

import { MutationAST } from '@astrale-os/sdk/mutation'

/** Admit the canonical document or Core's exact rich authoring input at the CLI JSON boundary. */
export function prepareMutation(input: unknown): MutationASTValue {
  if (isCanonicalCandidate(input)) return MutationAST.decode(input)
  return MutationAST.create(input as MutationInput)
}

function isCanonicalCandidate(input: unknown): boolean {
  return (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (Object.hasOwn(input, 'format') || Object.hasOwn(input, 'version'))
  )
}
