import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { withAdminKernelClient } from '../../kernel/client'
import {
  ADMIN_KERNEL_INSTANCE,
  buildAdminCreateInstanceInput,
  type AdminCreateInstanceOpts,
  type AdminKernelInstanceInfo,
} from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { addInstance, setActive } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { isRawOutput, output } from '../../lib/output'
import { validateSlug } from '../../lib/validation'

type CreateOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  AdminCreateInstanceOpts & {
    bookmarkUrl?: string
    use?: boolean
  }

export default {
  name: 'create',
  description: 'Create an instance through the admin kernel',
  afterHelpText: `
Behavior:
  This command never starts a local manager. It calls the configured admin
  kernel's AdminKernelInstance.create method. Target the admin kernel with
  --admin, --admin-url, or \`astrale admin use\`. Legacy --url and -i/--instance
  are still accepted as admin target aliases for this command.

Examples:
  $ astrale instance create demo --owner-id user_123
  $ astrale instance create demo --admin staging-admin --bookmark-url https://demo.example.com --use
`,
  arguments: [{ name: 'id', description: 'Instance id', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--label <label>', description: 'Human-readable label' },
    { flags: '--host-id <id>', description: 'Admin KernelHost id to provision on' },
    { flags: '--graph-name <name>', description: 'Graph name requested from admin' },
    { flags: '--issuer <url>', description: 'Kernel issuer requested from admin' },
    {
      flags: '--owner-id <id>',
      description: 'Owner account id (defaults to active identity name)',
    },
    { flags: '--owner-email <email>', description: 'Owner email metadata' },
    { flags: '--owner-first-name <name>', description: 'Owner first-name metadata' },
    { flags: '--owner-last-name <name>', description: 'Owner last-name metadata' },
    { flags: '--no-install-distribution', description: 'Ask admin not to install distribution' },
    { flags: '--no-seed-user', description: 'Ask admin not to seed the owner user' },
    { flags: '--trust-policy <path>', description: 'Read trust policy JSON and pass it to admin' },
    {
      flags: '--provisioning-policy <path>',
      description: 'Read provisioning policy JSON and pass it to admin',
    },
    { flags: '--disable-discovery', description: 'Ask admin to disable external issuer discovery' },
    {
      flags: '--bookmark-url <url>',
      description: 'Also store a local bookmark for the created kernel URL',
    },
    { flags: '--use', description: 'Set the new bookmark active; requires --bookmark-url' },
  ],
  action: async (id: string, opts: CreateOpts) => {
    try {
      validateSlug(id)
      const input = await buildAdminCreateInstanceInput(id, opts)
      const result = await withAdminKernelClient(
        opts,
        async (ctx) =>
          (await ctx.client.call(
            `${ADMIN_KERNEL_INSTANCE}/create`,
            input,
          )) as AdminKernelInstanceInfo,
      )

      if (opts.bookmarkUrl) {
        await addInstance(result.id, {
          url: opts.bookmarkUrl,
          name: opts.label ?? result.id,
          kind: 'bookmark',
          mode: 'remote',
          defaultIdentity: input.owner.id,
          issuer: result.issuer,
        })
        if (opts.use) await setActive(result.id)
      } else if (opts.use) {
        throw new Error('--use requires --bookmark-url <url>')
      }

      if (isRawOutput(opts)) {
        output(result, opts)
        return
      }
      log.success(`Instance created: ${result.id}`)
      log.dim(`  status: ${result.status}`)
      log.dim(`  issuer: ${result.issuer}`)
      log.dim(`  owner: ${result.ownerUserId}`)
      if (opts.bookmarkUrl)
        log.dim(`  bookmarked: ${opts.bookmarkUrl}${opts.use ? ' (active)' : ''}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
