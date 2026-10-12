import { isNodeId, NodeId } from '@astrale-os/sdk/graph/node'

import type { ConnectionContext, KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program'

import { runKernelCommand } from '../../connection'
import { executionStatusCommand } from '../../connection/execution'
import { targetFlags } from '../../connection/target'
import { AstraleError } from '../../errors'
import { failInput } from '../../lib/terminal/log'

type Operation = 'apply' | 'abort'
type Options = KernelCommandOpts & {
  readonly validationScope?: 'incremental' | 'full'
  readonly validationCounts?: 'sample' | 'exact'
}

/**
 * One signal to a Root repair session, at the index its status announces now: `apply` the command
 * it awaits, `abort` the attempt it runs. A session that announces none is refused before any
 * signal, so no signal waits ahead of the session and fires later on its own.
 */
export function installationCommand(operation: Operation, rawId: string, opts: Options) {
  if (!isNodeId(rawId)) throw new TypeError('Expected an installation Execution ID.')
  const id = NodeId(rawId)
  const observe = executionStatusCommand(id, targetFlags(opts))
  return {
    opts,
    label: `Installation ${operation}: ${id}`,
    credential: { principal: 'caller' as const },
    fn: async ({ session }: ConnectionContext) => {
      const api = session.schema.installation
      const status = await api.status(id)
      const detail = 'detail' in status ? status.detail : undefined
      const phase = detail?.phase ?? status.state
      if (operation === 'apply') {
        const index = detail?.command
        if (index === undefined) {
          throw new AstraleError(
            'SESSION_NOT_AWAITING',
            `Execution ${id} awaits no command (${phase}); nothing was sent.`,
            `Read it with ${observe}: only a maintenance session whose phase is awaiting accepts apply.`,
          )
        }
        await api.apply(id, {
          index,
          validation: {
            ...(opts.validationScope === undefined ? {} : { scope: opts.validationScope }),
            ...(opts.validationCounts === undefined ? {} : { counts: opts.validationCounts }),
          },
        })
        return { execution: id, signal: `command:${index}`, accepted: true }
      }
      // Only an attempt toward the target reads its abort signal; a return to the source runs on.
      const attempt = detail?.attempt?.destination === 'target' ? detail.attempt.number : undefined
      if (attempt === undefined) {
        throw new AstraleError(
          'SESSION_NO_ATTEMPT',
          `Execution ${id} runs no attempt toward its target (${phase}); nothing was sent.`,
          `Read it with ${observe}: an attempt back to the source cannot be aborted.`,
        )
      }
      await api.abort(id, attempt)
      return { execution: id, signal: `abort:${attempt}`, accepted: true }
    },
  }
}

const descriptions: Record<Operation, string> = {
  apply: 'Apply the target of a Root repair session at the command it awaits',
  abort: 'Stop the attempt a Root repair session runs toward its target; it waits again',
}

export const installationCommands: CommandDefinition[] = (
  Object.keys(descriptions) as Operation[]
).map((operation) => ({
  name: operation,
  description: descriptions[operation],
  arguments: [{ name: 'execution', description: 'Exact Execution ID returned by domain install' }],
  options:
    operation === 'apply'
      ? [
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
      : [],
  afterHelpText: `
Root only, on the same Instance as the install. Each command reads the
session's status, then sends one signal at the index it announces: apply the
command it awaits (refused SESSION_NOT_AWAITING while it drains or attempts),
abort the attempt it runs toward the target (refused SESSION_NO_ATTEMPT when
none runs; an attempt back to the source cannot be aborted). Signals
are never retried. An accepted signal is not a completed installation: follow
it with astrale execution status|result <execution>. To return to the source
schema instead, use astrale execution cancel <execution>.
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
