import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { withKernelClient } from '../../kernel/client'
import { ADMIN_KERNEL_INSTANCE, type AdminKernelInstanceInfo } from '../../lib/admin-instance'
import { readInstances, removeInstance, resolveInstanceKey } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { isRawOutput, output } from '../../lib/output'

type DeleteOpts = KernelCommandOpts & {
  keepBookmark?: boolean
}

export default {
  name: 'delete',
  description: 'Delete an admin-managed instance through the admin kernel',
  afterHelpText: `
Behavior:
  This is an admin operation. It calls AdminKernelInstance.delete on the admin
  kernel and never talks directly to a local manager. If a local bookmark with
  the same name exists, it is removed after the admin delete succeeds unless
  --keep-bookmark is passed.
`,
  arguments: [{ name: 'id', description: 'Instance id', required: true }],
  options: [{ flags: '--keep-bookmark', description: 'Do not remove a same-name local bookmark' }],
  action: async (id: string, opts: DeleteOpts) => {
    try {
      const result = await withKernelClient(
        opts,
        async (ctx) =>
          (await ctx.client.call(`${ADMIN_KERNEL_INSTANCE}/delete`, {
            id,
          })) as AdminKernelInstanceInfo,
      )

      if (!opts.keepBookmark) {
        const store = await readInstances()
        const key = resolveInstanceKey(store, id)
        if (key) await removeInstance(key)
      }

      if (isRawOutput(opts)) {
        output(result, opts)
        return
      }
      log.success(`Deleted instance: ${result.id}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
