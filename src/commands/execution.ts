import type { NodeId } from '@astrale-os/sdk/graph/node'
import type { Path } from '@astrale-os/sdk/graph/path'

import { readFile } from 'node:fs/promises'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program'

import { runKernelCommand } from '../connection'
import { callableOrigin } from '../connection/callable-target'
import {
  acceptExecutionReceipt,
  parseExecutionReceipt,
  type ExecutionReceipt,
} from '../connection/execution'
import { FOLLOW_WAIT_MS } from '../connection/installation-result'
import { targetFlags } from '../connection/target'
import { AstraleError } from '../errors'
import { shellCommand } from '../lib/shell-command'
import { failInput } from '../lib/terminal/log'

type ExecutionOptions = KernelCommandOpts & { waitMs?: string }

function requireIdentity(opts: ExecutionOptions): void {
  if (opts.creds !== undefined || opts.anonymous === true) {
    throw new AstraleError(
      'EXECUTION_IDENTITY_REQUIRED',
      'Execution commands require a named or default identity, without --creds or --anonymous.',
    )
  }
}

/** The observation receipt of the Execution a call to `path` started in this command's session. */
export function executionReceipt(ctx: ConnectionContext, path: Path, id: NodeId): ExecutionReceipt {
  try {
    return acceptExecutionReceipt({
      kind: 'astrale.execution',
      version: 2,
      id,
      kernel: ctx.target.kernelIssuer,
      origin: callableOrigin(path),
      principal: ctx.credentialPrincipal(),
    })
  } catch {
    // The Execution exists: keep only its ID and never start it again.
    throw new AstraleError(
      'EXECUTION_RECEIPT_INVALID',
      `The call started Execution ${id}, but its observation receipt could not be constructed.`,
      `Retain Execution ID ${id} and reconstruct its receipt from the initiating context. Do not call again.`,
    )
  }
}

/** Command action seam: real receipt-file admission and the session's Execution Methods. */
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
  const target = targetFlags(opts)
  const read = (method: 'status' | 'result', ...args: string[]) =>
    shellCommand(['astrale', 'execution', method, file, ...args, ...target])
  await run({
    opts,
    label: `Execution ${operation}`,
    credential: { principal: 'execution', receipt },
    ...(operation === 'result'
      ? {
          pending: {
            execution: receipt.id,
            follow: read('result', '--wait-ms', String(FOLLOW_WAIT_MS)),
            observe: read('status'),
            waited: waitMs !== undefined && waitMs > 0,
          },
        }
      : {}),
    fn: async ({ session }) =>
      operation === 'status'
        ? session.execution.status(receipt.id)
        : session.execution.result(receipt.id, waitMs === undefined ? {} : { waitMs }),
  })
}

export function observationCommand(operation: 'status' | 'result'): CommandDefinition {
  return {
    name: operation,
    description: `Read an execution ${operation} in the context its receipt records`,
    arguments: [
      { name: 'receipt', description: 'File containing the JSON receipt astrale call printed' },
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
with --as (or its configured default); the Kernel refuses any other caller.
Domain receipts resolve the current installed issuer for their origin; caller
receipts preserve caller authority without Domain exchange. Treat a third-party
receipt like a third-party command. Files supply no exchange URL or credential. The Kernel remains
the authority for access, including modified or manually reconstructed receipts.
A result whose execution has not ended is no failure: the CLI says it is still
running, prints the commands that wait for it and read its status, and exits
75 (try again later). --json keeps the Kernel's EXECUTION_PENDING refusal on
stderr and adds "execution", "follow" and "observe". --timeout bounds the
request independently of --wait-ms. No workflow is restarted or cancelled.
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
