import { isNodeId, NodeId } from '@astrale-os/sdk/graph/node'

import type { ConnectionContext, KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program'

import { runKernelCommand } from '../../connection'
import {
  installationResultCommand,
  installationStatusCommand,
} from '../../connection/installation-result'
import { targetFlags } from '../../connection/target'
import { failInput } from '../../lib/terminal/log'

type Operation = 'status' | 'result' | 'apply' | 'abort' | 'cancel' | 'resume'
type Options = KernelCommandOpts & {
  readonly uninstall?: boolean
  readonly command?: string
  readonly attempt?: string
  readonly waitMs?: string
  readonly validationScope?: 'incremental' | 'full'
  readonly validationCounts?: 'sample' | 'exact'
}

function integer(value: string | undefined, flag: string, minimum: number): number {
  if (
    value === undefined ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < minimum
  ) {
    throw new TypeError(`${flag} must be an integer of at least ${minimum}.`)
  }
  return Number(value)
}

/**
 * Explicit, single commands against the existing Execution; never start another install. Each
 * request keeps the session's --timeout; `result` waits up to --wait-ms across requests.
 */
export function installationCommand(operation: Operation, rawId: string, opts: Options) {
  if (!isNodeId(rawId)) throw new TypeError('Expected an installation Execution ID.')
  if (opts.uninstall && (operation === 'apply' || operation === 'abort'))
    throw new TypeError('An uninstall has no repair session signals.')
  const id = NodeId(rawId)
  const index = operation === 'apply' ? integer(opts.command, '--command', 1) : undefined
  const attempt = operation === 'abort' ? integer(opts.attempt, '--attempt', 1) : undefined
  const waitMs = opts.waitMs === undefined ? undefined : integer(opts.waitMs, '--wait-ms', 0)
  const lifecycle = opts.uninstall ? 'uninstall' : 'install'
  return {
    opts,
    label: `Installation ${operation}: ${id}`,
    credential: { principal: 'caller' as const },
    ...(operation === 'result'
      ? {
          pending: {
            execution: id,
            follow: installationResultCommand(id, lifecycle, targetFlags(opts)),
            observe: installationStatusCommand(id, lifecycle, targetFlags(opts)),
            waited: waitMs !== undefined && waitMs > 0,
          },
        }
      : {}),
    fn: async ({ session }: ConnectionContext) => {
      const api = session.schema.installation
      const reads = opts.uninstall ? session.schema.uninstallation : api
      switch (operation) {
        case 'status':
          return reads.status(id)
        case 'result':
          return reads.result(id, waitMs === undefined ? {} : { waitMs })
        case 'apply':
          await api.apply(id, {
            index: index!,
            validation: {
              ...(opts.validationScope === undefined ? {} : { scope: opts.validationScope }),
              ...(opts.validationCounts === undefined ? {} : { counts: opts.validationCounts }),
            },
          })
          return { execution: id, signal: `command:${index}`, accepted: true }
        case 'abort':
          await api.abort(id, attempt!)
          return { execution: id, signal: `abort:${attempt}`, accepted: true }
        case 'cancel':
          return reads.cancel(id, {})
        case 'resume':
          return reads.resume(id)
      }
    },
  }
}

const descriptions: Record<Operation, string> = {
  status: 'Read the state and repair progress of an installation',
  result: 'Read the terminal installation outcome, optionally waiting',
  apply: 'Apply the target of a Root repair session using its next command index',
  abort: 'Stop the specified repair attempt and return the session to waiting',
  cancel: 'Cooperatively cancel the installation or restore a repair session source',
  resume: 'Resume an existing paused installation or repair session',
}

export const installationCommands: CommandDefinition[] = (
  Object.keys(descriptions) as Operation[]
).map((operation) => ({
  name: operation,
  description: descriptions[operation],
  arguments: [{ name: 'execution', description: 'Exact Execution ID returned by domain install' }],
  options: [
    ...(['status', 'result', 'cancel', 'resume'].includes(operation)
      ? [
          {
            flags: '--uninstall',
            description: 'Read or operate an uninstall Execution instead of an install',
          },
        ]
      : []),
    ...(operation === 'apply'
      ? [
          {
            flags: '--command <index>',
            description: 'The next detail.command read from status (required)',
          },
          {
            flags: '--validation-scope <scope>',
            description: 'Widen validation scope',
            choices: ['incremental', 'full'],
          },
          {
            flags: '--validation-counts <counts>',
            description: 'Widen failure counting',
            choices: ['sample', 'exact'],
          },
        ]
      : operation === 'abort'
        ? [
            {
              flags: '--attempt <number>',
              description: 'The running detail.attempt.number read from status (required)',
            },
          ]
        : operation === 'result'
          ? [
              {
                flags: '--wait-ms <milliseconds>',
                description: 'Wait for the terminal outcome; --timeout also bounds the request',
              },
            ]
          : []),
  ],
  afterHelpText: `
Use the same Instance and initiating identity (or Root) as the install.
Status and result are reads: their JSON reports the Kernel state/outcome,
including a failed or cancelled outcome. A result whose installation has not
ended is no failure: the CLI says it is still running, prints the commands
that wait for it and read its status, and exits 75 (try again later); --json
keeps EXECUTION_PENDING on stderr with "execution", "follow" and "observe".
No command restarts the install or generates an operation ID.
Apply, abort and resume require Root. Read status before sending the exact
command or attempt index it names. Signals are never automatically retried.
An accepted signal is not a completed installation: read status/result next.
Cooperative cancel restores a repair session's source only if validation allows
it. Inspect its status afterward. No forced cancel or Execution delete is offered.
`,
  action: async (id: string, opts: Options) => {
    let command: ReturnType<typeof installationCommand>
    try {
      command = installationCommand(operation, id, opts)
    } catch (error) {
      failInput(error, opts)
    }
    await runKernelCommand(command)
  },
}))
