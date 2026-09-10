import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { inviteOwnedInstance } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { log, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'

type InviteOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    expiresInDays?: string
  }

export default {
  name: 'invite',
  description: 'Invite a user to one managed instance',
  afterHelpText: `
Behavior:
  Calls Instance.inviteUser on the exact managed Instance. The caller must
  manage that Instance; ordinary Instance members cannot invite. Access is
  always Instance member access and never grants Fleet or Host authority.

  The command returns after WorkOS durably accepts the Invitation request.
  After the recipient accepts, Admin automatically reconciles their child Shell
  user and Instance access through its retryable webhook consumer.

Examples:
  $ astrale instance invite my-app person@example.com
  $ astrale instance invite my-app person@example.com --json
`,
  arguments: [
    { name: 'id', description: 'Instance slug or Node path', required: true },
    { name: 'email', description: 'Email address to invite', required: true },
  ],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--expires-in-days <days>', description: 'Invitation lifetime from 1 to 30 days' },
  ],
  action: async (id: string, email: string, opts: InviteOpts) => {
    try {
      const expiresInDays = optionalInteger(opts.expiresInDays, 1, 30, '--expires-in-days')
      const invitation = await withSpinner(
        `Inviting ${email} to ${id}`,
        !isMachine(opts),
        () => inviteOwnedInstance(opts, id, email, expiresInDays),
        { success: () => `Invitation sent to ${email}` },
      )

      if (isMachine(opts)) {
        output(invitation, opts)
        return
      }
      log.dim(`  invitation: ${invitation.id}`)
      log.dim(`  state: ${invitation.state}`)
      if (invitation.instance) log.dim(`  instance: ${invitation.instance}`)
      if (invitation.claimedBy) log.dim(`  user: ${invitation.claimedBy}`)
      log.dim('  access: automatic after acceptance')
    } catch (error) {
      await formatKernelError(error, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

function optionalInteger(
  input: string | undefined,
  minimum: number,
  maximum: number,
  flag: string,
): number | undefined {
  return input === undefined ? undefined : requiredInteger(input, minimum, maximum, flag)
}

export function requiredInteger(
  input: string,
  minimum: number,
  maximum: number,
  flag: string,
): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(input)) {
    throw new TypeError(`${flag} must be an integer from ${minimum} to ${maximum}.`)
  }
  const value = Number(input)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${flag} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}
