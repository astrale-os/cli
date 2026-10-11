import { issuer } from '@astrale-os/sdk/auth'
import { isNodeId, NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { z } from 'zod'

/** Public, nonsecret receipt. It describes observation context; it grants no authority. */
export const executionReceiptSchema = z.strictObject({
  kind: z.literal('astrale.execution'),
  version: z.literal(1),
  id: z.string().refine(isNodeId).transform(NodeId),
  kernel: z.string().refine(issuer.is).transform(issuer.accept),
  caller: z.string().refine(isNodeId).transform(NodeId),
  origin: z.string().min(1),
  principal: z.enum(['domain', 'caller']),
})

export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>

export function acceptExecutionReceipt(input: unknown): ExecutionReceipt {
  const parsed = executionReceiptSchema.safeParse(input)
  if (!parsed.success) throw new TypeError('Expected an astrale.execution version 1 receipt.')
  const receipt = parsed.data
  Path.id(receipt.id)
  Path.id(receipt.caller)
  const origin = Path.parse(`/:${receipt.origin}`)
  if (
    origin.ast.anchor.kind !== 'domain' ||
    origin.ast.anchor.origin !== receipt.origin ||
    origin.ast.steps.length !== 0
  ) {
    throw new TypeError('Execution receipt origin must be a Domain origin.')
  }
  return Object.freeze(receipt)
}

/** Malformed files are reported without echoing their possibly private contents. */
export function parseExecutionReceipt(text: string): ExecutionReceipt {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new TypeError('The execution receipt file must contain valid JSON.')
  }
  return acceptExecutionReceipt(value)
}
