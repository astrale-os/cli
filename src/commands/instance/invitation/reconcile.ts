import type { KernelCommandOpts } from '../../../connection'
import type { CommandDefinition } from '../../../program/index'

import { formatKernelError } from '../../../connection/errors'
import { reconcileOwnedInvitation } from '../../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../../lib/admin-target'
import { log, withSpinner } from '../../../lib/log'
import { isMachine, output } from '../../../lib/output'
import { requiredInteger } from '../invite'

type ReconcileOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    wait?: boolean
    waitTimeout?: string
  }

export default {
  name: 'reconcile',
  description: 'Resume one invitation until Instance access is ready',
  arguments: [{ name: 'id', description: 'Invitation Node path', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--no-wait', description: 'Reconcile once without waiting for acceptance' },
    {
      flags: '--wait-timeout <seconds>',
      description: 'Maximum acceptance wait from 1 to 3600 seconds',
      default: '600',
    },
  ],
  action: async (id: string, opts: ReconcileOpts) => {
    try {
      const timeoutSeconds = requiredInteger(opts.waitTimeout ?? '600', 1, 3_600, '--wait-timeout')
      const invitation = await withSpinner(
        opts.wait === false
          ? 'Reconciling invitation'
          : 'Reconciling invitation until access is ready',
        !isMachine(opts),
        () =>
          reconcileOwnedInvitation(
            opts,
            id,
            opts.wait === false ? undefined : timeoutSeconds * 1_000,
          ),
        {
          success: (result) =>
            result.state === 'accepted'
              ? `Instance access ready for ${result.email}`
              : `Invitation is ${result.state}`,
        },
      )
      if (isMachine(opts)) {
        output(invitation, opts)
        return
      }
      log.success(`Invitation ${invitation.state}: ${invitation.email}`)
      if (invitation.claimedBy) log.dim(`  user: ${invitation.claimedBy}`)
    } catch (error) {
      await formatKernelError(error, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition
