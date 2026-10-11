import { issuer, type IssuerId } from '@astrale-os/sdk/auth'
import { isNodeId, NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { z } from 'zod'

/** Public, nonsecret receipt. It describes observation context; it grants no authority. */
export interface ExecutionReceipt {
  readonly kind: 'astrale.execution'
  readonly version: 2
  readonly id: NodeId
  readonly kernel: IssuerId
  readonly origin: string
  readonly principal: 'domain' | 'caller'
}

export const executionReceiptSchema: z.ZodType<ExecutionReceipt> = z.strictObject({
  kind: z.literal('astrale.execution'),
  version: z.literal(2),
  id: z.string().refine(isNodeId).transform(NodeId),
  kernel: z.string().refine(issuer.is).transform(issuer.accept),
  origin: z.string().min(1),
  principal: z.enum(['domain', 'caller']),
})

export function acceptExecutionReceipt(input: unknown): ExecutionReceipt {
  const parsed = executionReceiptSchema.safeParse(input)
  if (!parsed.success) throw new TypeError('Expected an astrale.execution version 2 receipt.')
  const receipt = parsed.data
  Path.id(receipt.id)
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
