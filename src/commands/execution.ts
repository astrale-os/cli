import { execution } from '@astrale-os/sdk/client/session'
import { isNodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { schema } from '@astrale-os/sdk/schema'
import { readFile } from 'node:fs/promises'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program'

import { expandSelfInCall, runKernelCommand } from '../connection'
import { callableOrigin } from '../connection/callable-target'
import {
  acceptExecutionReceipt,
  parseExecutionReceipt,
  type ExecutionReceipt,
} from '../connection/execution'
import { AstraleError } from '../errors'
import { failInput } from '../lib/log'
import { parseParams } from './call'
import { resolveCallableFromBundle } from './call-describe'

type ExecutionOptions = KernelCommandOpts & { data?: string; waitMs?: string }

function requireIdentity(opts: ExecutionOptions): void {
  if (opts.creds !== undefined || opts.anonymous === true) {
    throw new AstraleError(
      'EXECUTION_IDENTITY_REQUIRED',
      'Execution commands require a named or default identity, without --creds or --anonymous.',
    )
  }
}

/** Explicit start, not a heuristic applied to arbitrary call output. */
export async function startExecution(
  ctx: ConnectionContext,
  path: Path,
  params: Record<string, unknown>,
  expandParameters: boolean,
): Promise<ExecutionReceipt> {
  const origin = callableOrigin(path)
  if (origin === undefined)
    throw new TypeError('A durable callable must name its declaring Domain.')
  const installed = await ctx.session.schema.bundle(origin)
  const declaration = resolveCallableFromBundle(path, installed.bundle)
  if (declaration?.callable.execution?.durable !== true) {
    throw new AstraleError(
      'EXECUTION_NOT_DURABLE',
      'The installed callable is not declared durable. Use astrale call for ordinary values.',
    )
  }
  // Bundle resolution has authenticated this Session. Detect a missing selection
  // before starting any durable work; read it again afterward to capture recovery.
  ctx.credentialPrincipal()
  const self = await ctx.self()
  const caller = self.id
  const expanded = await expandSelfInCall(path.raw, expandParameters ? params : {}, {
    ...ctx,
    self: async () => self,
  })
  // ClientSession serializes the fingerprint in the invocation target. The Kernel
  // checks it against its pinned declaration before dispatch, including durability.
  const value = await ctx.session.invoke(
    {
      origin,
      callable: declaration.callable.key,
      fingerprint: schema.callableFingerprint(declaration.callable),
      target: Path.parse(expanded.path),
      outputMode: 'value',
    },
    expandParameters ? expanded.parameters : params,
  )
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('id' in value) ||
    !isNodeId(value.id)
  ) {
    throw new AstraleError(
      'EXECUTION_RECEIPT_INVALID',
      'The durable call did not return an Execution reference. Its outcome is unknown; do not automatically start it again.',
    )
  }

  try {
    return acceptExecutionReceipt({
      kind: 'astrale.execution',
      version: 1,
      id: value.id,
      kernel: ctx.target.kernelIssuer,
      caller,
      origin,
      principal: ctx.credentialPrincipal(),
    })
  } catch {
    // Preserve only the validated public reference, never arbitrary result/error data.
    throw new AstraleError(
      'EXECUTION_RECEIPT_INVALID',
      `The durable call returned Execution ${value.id}, but its observation receipt could not be constructed.`,
      `Retain Execution ID ${value.id} and reconstruct its receipt from the initiating context. Do not start it again.`,
    )
  }
}

export const start = {
  name: 'start',
  description: 'Start a declared durable callable and print its portable observation receipt',
  arguments: [
    { name: 'path', description: 'Durable Function or Method Path' },
    { name: 'params...', description: 'Params as key=value pairs', required: false },
  ],
  options: [
    { flags: '-d, --data <json>', description: 'Params as JSON: inline, - (stdin), or @<file>' },
  ],
  afterHelpText: `
Save the receipt with --json > receipt.json. It contains no credential. Keep
it even if the process ends before the workflow does. Starting is not retried
automatically. Generic astrale call output remains unchanged.

  astrale execution start '@record::notes.example:class.Note.method.complete' --as alice --url https://example/api --json > receipt.json
  astrale execution result receipt.json --as alice --url https://example/api --wait-ms 10000 --json
`,
  action: async (rawPath, rawParams, opts: ExecutionOptions) => {
    let path: Path
    let params: Record<string, unknown>
    try {
      requireIdentity(opts)
      path = Path.parse(rawPath as string)
      params = await parseParams(rawParams as string[], opts.data)
    } catch (error) {
      failInput(error, opts)
    }
    await runKernelCommand({
      opts,
      label: `Start ${path.raw}`,
      credential: { principal: 'callable', path },
      fn: (ctx) =>
        startExecution(
          ctx,
          path,
          params,
          opts.data === undefined && (rawParams as string[]).length > 0,
        ),
    })
  },
} satisfies CommandDefinition

/** Command action seam: real receipt-file admission and SDK reference wiring. */
export async function observeExecution(
  operation: 'status' | 'result',
  file: string,
  opts: ExecutionOptions,
  run: typeof runKernelCommand = runKernelCommand,
): Promise<void> {
  requireIdentity(opts)
  let waitMs: number | undefined
  if (opts.waitMs !== undefined) {
    if (!/^\d+$/.test(opts.waitMs) || !Number.isSafeInteger(Number(opts.waitMs)))
      throw new TypeError('--wait-ms must be a nonnegative safe integer.')
    waitMs = Number(opts.waitMs)
  }
  const receipt = parseExecutionReceipt(await readFile(file, 'utf8'))
  await run({
    opts,
    label: `Execution ${operation}`,
    credential: { principal: 'execution', receipt },
    fn: async ({ session }) =>
      operation === 'status'
        ? session.invoke(execution.status(receipt.id), {})
        : session.invoke(execution.result(receipt.id), waitMs === undefined ? {} : { waitMs }),
  })
}

export function observationCommand(operation: 'status' | 'result'): CommandDefinition {
  return {
    name: operation,
    description: `Read an execution ${operation} using its retained caller and Domain context`,
    arguments: [
      { name: 'receipt', description: 'File containing the execution start JSON receipt' },
    ],
    options:
      operation === 'result'
        ? [
            {
              flags: '--wait-ms <milliseconds>',
              description: 'Wait for a terminal outcome (default: no wait)',
            },
          ]
        : [],
    afterHelpText: `
Select the receipt's exact Kernel with -i or --url and the initiating identity
with --as (or its configured default). A mismatch is refused before Domain
exchange. Domain receipts resolve the current installed issuer for their origin;
caller receipts preserve caller authority without Domain exchange. Treat a third-party receipt
like a third-party command. Files supply no exchange URL or credential. The Kernel remains
the authority for access, including modified or manually reconstructed receipts.
Pending results preserve the Kernel EXECUTION_PENDING error. --timeout bounds
the request independently of --wait-ms. No workflow is restarted or cancelled.
`,
    action: async (file, opts: ExecutionOptions) => {
      try {
        await observeExecution(operation, file as string, opts)
      } catch (error) {
        failInput(error, opts)
      }
    },
  }
}
