import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE, type InstanceInfo } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { readInstances, removeInstance, resolveInstanceKey } from '../../lib/instance'
import { fatal, log, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'

type DeleteOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    keepBookmark?: boolean
  }

export default {
  name: 'delete',
  description: 'Delete an admin-managed instance through the admin kernel',
  afterHelpText: `
Behavior:
  Calls Instance.delete on the configured admin kernel: best-effort decommission
  of the instance's routing-registry entry + WorkOS org (frees the slug), then
  removes the Instance record. The host kernel itself is NOT deregistered (the
  deprovisioning saga is a follow-up). A same-name local bookmark is removed
  after the delete succeeds unless --keep-bookmark is passed.
`,
  arguments: [{ name: 'id', description: 'Instance slug', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--keep-bookmark', description: 'Do not remove a same-name local bookmark' },
  ],
  action: async (id: string, opts: DeleteOpts) => {
    try {
      const result = await withSpinner(`Deleting instance ${id}`, !isMachine(opts), () =>
        withAdminKernelClient(
          opts,
          async (ctx) =>
            (await ctx.client.call(`${ADMIN_INSTANCE}/delete`, { id })) as InstanceInfo,
        ),
      )

      if (!opts.keepBookmark) {
        const store = await readInstances()
        const key = resolveInstanceKey(store, id)
        if (key) await removeInstance(key)
      }

      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      log.success(`Deleted instance: ${result.slug}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
