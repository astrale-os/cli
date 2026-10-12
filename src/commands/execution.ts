import type { Path } from '@astrale-os/sdk/graph/path'

import { isNodeId, NodeId } from '@astrale-os/sdk/graph/node'
import { readFile } from 'node:fs/promises'

import type { ConnectionContext, KernelCommandOpts } from '../connection'
import type { CredentialIntent } from '../connection/credential'
import type { CommandDefinition } from '../program'

import { runKernelCommand } from '../connection'
import { callableOrigin } from '../connection/callable-target'
import {
  acceptExecutionReceipt,
  executionResultCommand,
  executionStatusCommand,
  parseExecutionReceipt,
  type ExecutionReceipt,
} from '../connection/execution'
import { targetFlags } from '../connection/target'
import { AstraleError } from '../errors'
import { failInput } from '../lib/terminal/log'

type Method = 'status' | 'result' | 'cancel' | 'resume' | 'signal'
type ExecutionOptions = KernelCommandOpts & { waitMs?: string; value?: string }

function requireIdentity(opts: ExecutionOptions): void {
  if (opts.creds !== undefined || opts.anonymous === true) {
    throw new AstraleError(
      'EXECUTION_IDENTITY_REQUIRED',
      'Execution receipts require a named or default identity, without --creds or --anonymous.',
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

/**
 * The Execution an argument names and the authority that reaches it: an existing file is the
 * receipt `astrale call` printed, read in the context it records; anything else is an Execution ID,
 * reached as the caller itself.
 */
async function addressed(
  argument: string,
  opts: ExecutionOptions,
): Promise<{ readonly id: NodeId; readonly credential: CredentialIntent }> {
  let text: string
  try {
    text = await readFile(argument, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (!isNodeId(argument)) {
      throw new TypeError('Expected an Execution ID or the file of an execution receipt.')
    }
    return { id: NodeId(argument), credential: { principal: 'caller' } }
  }
  requireIdentity(opts)
  const receipt = parseExecutionReceipt(text)
  return { id: receipt.id, credential: { principal: 'execution', receipt } }
}

function nonnegative(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new TypeError('--wait-ms must be a nonnegative safe integer.')
  return Number(value)
}

function signalValue(text: string | undefined): unknown {
  if (text === undefined) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new TypeError('--value must be a JSON value.')
  }
}

/**
 * One `K.Execution` Method on the addressed Execution, sent once through the session; never start
 * it again. `signal` resolves the named durable promise with `--value` (JSON, `null` without it).
 */
export async function executionCommand(
  method: Method,
  argument: string,
  opts: ExecutionOptions,
  name?: string,
) {
  const waitMs = method === 'result' ? nonnegative(opts.waitMs) : undefined
  const value = method === 'signal' ? signalValue(opts.value) : undefined
  const { id, credential } = await addressed(argument, opts)
  const target = targetFlags(opts)
  return {
    opts,
    label: `Execution ${method}: ${id}`,
    credential,
    ...(method === 'result'
      ? {
          pending: {
            execution: id,
            follow: executionResultCommand(argument, target),
            observe: executionStatusCommand(argument, target),
            waited: waitMs !== undefined && waitMs > 0,
          },
        }
      : {}),
    fn: async ({ session }: ConnectionContext) => {
      switch (method) {
        case 'status':
          return session.execution.status(id)
        case 'result':
          return session.execution.result(id, waitMs === undefined ? {} : { waitMs })
        case 'cancel':
          return session.execution.cancel(id)
        case 'resume':
          return session.execution.resume(id)
        case 'signal':
          await session.execution.signal(id, { name: name!, value: value as never })
          return { execution: id, signal: name, accepted: true }
      }
    },
  }
}

const ADDRESS_HELP = `
<execution> is an Execution ID, or the file holding the receipt astrale call
printed. An ID is reached as yourself: the installs and uninstalls you
started, a durable call you made as yourself, or any Execution as Root. A
receipt is reached in the context it records: select its exact Kernel with -i
or --url and the initiating identity with --as (or its configured default);
--creds and --anonymous are refused. Domain receipts resolve the current
installed issuer for their origin; files supply no exchange URL or
credential. The Kernel remains the authority for every access.`

const descriptions: Record<Method, { readonly summary: string; readonly help: string }> = {
  status: {
    summary: 'Read the state of an Execution',
    help: `
The status carries the engine state, the outcome once it ended and, for an
install or a repair session, its phase, progress and the command it awaits.`,
  },
  result: {
    summary: 'Read the terminal outcome of an Execution, optionally waiting',
    help: `
--wait-ms waits for the outcome in total, across requests (default: no wait).
A result whose Execution has not ended is no failure: the CLI says it is still
running, prints the commands that wait for it and read its status, and exits
75 (try again later). --json keeps the Kernel's EXECUTION_PENDING refusal on
stderr and adds "execution", "follow" and "observe". Ending the wait never
ends the Execution.`,
  },
  cancel: {
    summary: 'Cooperatively cancel an Execution',
    help: `
The Execution sees the cancel at its next wait and may compensate; one that
already ended is unchanged. An install before its point of no return ends
cancelled with nothing changed; a repair session attempts to return to its
source schema. Read its status afterwards. No forced cancel is offered.`,
  },
  resume: {
    summary: 'Resume a paused Execution',
    help: `
A paused Execution continues; a running one is unchanged.`,
  },
  signal: {
    summary: 'Resolve a durable promise the Execution awaits, once',
    help: `
Resolves the durable promise <name> with --value (JSON; null without it). A
promise resolves once: a second signal is refused. The Kernel checks neither
the name nor the value: a signal sent before its wait is kept until the
Execution reaches it, and a name it never waits for is never read. Drive a
repair session with domain installation apply|abort, which send the index it
announces.`,
  },
}

export const executionCommands: CommandDefinition[] = (Object.keys(descriptions) as Method[]).map(
  (method) => ({
    name: method,
    description: descriptions[method].summary,
    arguments: [
      { name: 'execution', description: 'Execution ID, or the receipt file astrale call printed' },
      ...(method === 'signal'
        ? [{ name: 'name', description: 'Name of the durable promise the Execution awaits' }]
        : []),
    ],
    options:
      method === 'result'
        ? [{ flags: '--wait-ms <milliseconds>', description: 'Wait for a terminal outcome' }]
        : method === 'signal'
          ? [
              {
                flags: '--value <json>',
                description: 'JSON value to resolve it with (default: null)',
              },
            ]
          : [],
    afterHelpText: `${descriptions[method].help}
${ADDRESS_HELP}
`,
    action: async (execution: string, ...rest: unknown[]) => {
      const [name, opts] = (method === 'signal' ? rest : [undefined, ...rest]) as [
        string | undefined,
        ExecutionOptions,
      ]
      let command: Awaited<ReturnType<typeof executionCommand>>
      try {
        command = await executionCommand(method, execution, opts, name)
      } catch (error) {
        failInput(error, opts)
      }
      await runKernelCommand(command)
    },
  }),
)
