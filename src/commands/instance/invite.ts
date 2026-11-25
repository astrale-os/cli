import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { executionStatusCommand } from '../../connection/execution'
import {
  acceptOperation,
  uuidv7,
  inviteOnInstance,
  shellInvitationSteps,
  type InstanceInvitation,
  type ShellProfile,
} from '../../lib/instance/invite'
import { log, withSpinner } from '../../lib/terminal/log'
import { isMachine, outputForMachine } from '../../lib/terminal/output'

type InviteOpts = KernelCommandOpts & {
  profile?: string
  name?: string
  operation?: string
  /** Kept so that older scripts still parse: the instance's Shell sets the lifetime. */
  expiresInDays?: string
}

export default {
  name: 'invite',
  description: "Invite a person to one instance, through that instance's Shell",
  afterHelpText: `
Behavior:
  Acts on the instance itself, as you, like its console does: finds or creates
  the account of the email (Shell User.create), gives a new account its
  profile (workspace.member by default, --profile admin for workspace.admin),
  then starts Shell Invitation.send. The Shell asks Admin to send the email and
  records you as the one who invited. Your identity on the instance needs
  user.writer (an administrator of the instance has it); a Fleet administrator
  who is not one can act as the instance's Root with --as <slug>-root.

  An account that already existed keeps its profiles: change them in the
  instance's console. The invitation lives 7 days; inviting the same email
  again resends it. Access starts when the person signs in from the link.

  If the command stops after creating the account, rerun it with the
  --operation it printed, within one hour, to resume on the same account.

Examples:
  $ astrale instance invite my-app person@example.com
  $ astrale instance invite my-app person@example.com --profile admin --name "Ada Lovelace"
  $ astrale instance invite my-app person@example.com --as my-app-root --json
`,
  arguments: [
    { name: 'id', description: 'Instance slug, bookmark or URL', required: true },
    { name: 'email', description: 'Email address to invite', required: true },
  ],
  options: [
    { flags: '--profile <profile>', description: 'Profile of a new account: member or admin' },
    {
      flags: '--name <name>',
      description: "A new account's displayed name (default: the email's local part)",
    },
    {
      flags: '--operation <uuid>',
      description: 'Resume an earlier attempt on the account it created',
    },
    { flags: '--expires-in-days <days>', description: 'Ignored: the instance sets 7 days' },
  ],
  action: async (id: string, email: string, opts: InviteOpts) => {
    let operation: string | undefined
    try {
      if (opts.instance !== undefined && opts.instance !== id) {
        throw new TypeError(`-i ${opts.instance} names another instance than ${id}.`)
      }
      const profile = acceptProfile(opts.profile)
      operation = opts.operation === undefined ? uuidv7() : acceptOperation(opts.operation)
      if (opts.expiresInDays !== undefined && !isMachine(opts)) {
        log.warn('--expires-in-days is ignored: the instance sets a 7-day lifetime.')
      }
      const target = { ...opts, instance: id }
      const invitation = await withSpinner(
        `Inviting ${email} to ${id}`,
        !isMachine(opts),
        () =>
          inviteOnInstance(shellInvitationSteps(target), {
            instance: id,
            email,
            ...(opts.name === undefined ? {} : { name: opts.name }),
            ...(profile === undefined ? {} : { profile }),
            operation,
          }),
        { success: () => `Invitation sent to ${email}` },
      )
      if (outputForMachine(invitation, opts)) return
      describe(invitation)
    } catch (error) {
      if (operation !== undefined && !isMachine(opts)) {
        log.dim(`  to resume on the same account within one hour: --operation ${operation}`)
      }
      await formatKernelError(error, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition

function describe(invitation: InstanceInvitation): void {
  log.dim(`  user: ${invitation.user}${invitation.created ? ' (created)' : ' (existing account)'}`)
  if (invitation.profile !== undefined) log.dim(`  profile: workspace.${invitation.profile}`)
  else log.dim('  profile: unchanged (the account already existed)')
  log.dim(`  invitation run: ${invitation.execution}`)
  log.dim(
    `  follow it: ${executionStatusCommand(invitation.execution, ['-i', invitation.instance])}`,
  )
  log.dim(`  operation: ${invitation.operation}`)
  log.dim('  access: after the person signs in from the link')
}

function acceptProfile(input: string | undefined): ShellProfile | undefined {
  if (input === undefined) return undefined
  if (input === 'member' || input === 'admin') return input
  throw new TypeError('--profile must be member or admin.')
}
