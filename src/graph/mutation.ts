import type { MutationAST as MutationASTValue, MutationInput } from '@astrale-os/sdk/mutation'

import { MutationAST } from '@astrale-os/sdk/mutation'

/** Admit the canonical document or Core's exact rich authoring input at the CLI JSON boundary. */
export function prepareMutation(input: unknown): MutationASTValue {
  if (isLegacyPatchData(input)) {
    throw new TypeError(
      'Legacy PatchData { nodes, edges } is not Mutation V3. Author { preconditions, operations } or a canonical astrale.graph.mutation/v3 document.',
    )
  }
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

function isLegacyPatchData(input: unknown): boolean {
  return (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    !Object.hasOwn(input, 'operations') &&
    (Object.hasOwn(input, 'nodes') || Object.hasOwn(input, 'edges'))
  )
}
