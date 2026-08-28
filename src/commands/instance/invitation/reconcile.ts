import type { KernelCommandOpts } from '../../../connection'
import type { CommandDefinition } from '../../../program/index'

import { formatKernelError } from '../../../connection/errors'
import { reconcileOwnedInvitation } from '../../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../../lib/admin-target'
import { log, withSpinner } from '../../../lib/log'
import { isMachine, output } from '../../../lib/output'

type ReconcileOpts = KernelCommandOpts & AdminTargetCommandOpts

export default {
  name: 'reconcile',
  description: 'Diagnose or repair one managed Instance invitation',
  afterHelpText: `
Recovery:
  Normal invitations reconcile automatically after WorkOS acceptance. Use this
  command only to diagnose or repair an exceptional retained Invitation.
`,
  arguments: [{ name: 'id', description: 'Invitation Node path', required: true }],
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (id: string, opts: ReconcileOpts) => {
    try {
      const invitation = await withSpinner(
        'Reconciling invitation',
        !isMachine(opts),
        () => reconcileOwnedInvitation(opts, id),
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
