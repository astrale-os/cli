import type { KernelCommandOpts } from '../../../connection'
import type { CommandDefinition } from '../../../program/index'

import { formatKernelError } from '../../../connection/errors'
import { statusManagedInvitation } from '../../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../../lib/admin-target'
import { log, withSpinner } from '../../../lib/log'
import { isMachine, output } from '../../../lib/output'

type StatusOpts = KernelCommandOpts & AdminTargetCommandOpts

export interface InvitationStatusDependencies {
  readonly statusManagedInvitation: typeof statusManagedInvitation
}

const defaultDependencies: InvitationStatusDependencies = Object.freeze({ statusManagedInvitation })

export function createInvitationStatusCommand(
  dependencies: InvitationStatusDependencies = defaultDependencies,
): CommandDefinition {
  return {
    name: 'status',
    description: 'Show one managed Instance invitation lifecycle',
    afterHelpText: `
Behavior:
  Observes the durable Admin Invitation without refreshing WorkOS, waiting for
  acceptance, reconciling access, or changing state. "accepted" means the
  invited user and Instance access are materialized. "pending" means access is
  not materialized yet; provider and Queue internals remain private.

  The sender and Fleet administrators can inspect the Invitation. Its claimed
  user can inspect it after acceptance. Email ownership alone grants no access.

Examples:
  $ astrale instance invitation status @invitation-id
  $ astrale instance invitation status @invitation-id --json
`,
    arguments: [{ name: 'id', description: 'Invitation Node path', required: true }],
    options: [...ADMIN_TARGET_OPTIONS],
    action: async (id: string, opts: StatusOpts) => {
      try {
        const invitation = await withSpinner('Fetching invitation', !isMachine(opts), () =>
          dependencies.statusManagedInvitation(opts, id),
        )
        if (isMachine(opts)) {
          output(invitation, opts)
          return
        }
        log.success(`Invitation ${invitation.state}: ${invitation.email}`)
        log.dim(`  invitation: ${invitation.id}`)
        log.dim(`  instance: ${invitation.instance}`)
        if (invitation.invitedBy) log.dim(`  invited by: ${invitation.invitedBy}`)
        if (invitation.claimedBy) log.dim(`  claimed by: ${invitation.claimedBy}`)
        log.dim(`  created: ${invitation.createdAt}`)
        if (invitation.expiresAt) log.dim(`  expires: ${invitation.expiresAt}`)
        if (invitation.acceptedAt) log.dim(`  accepted: ${invitation.acceptedAt}`)
      } catch (error) {
        await formatKernelError(error, isMachine(opts), undefined, opts.debug)
        process.exit(1)
      }
    },
  }
}

export default createInvitationStatusCommand()
