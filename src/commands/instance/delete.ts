import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { AdminInstanceNotFoundError } from '../../admin/instance'
import { formatKernelError } from '../../connection/errors'
import { deleteOwnedInstance } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { clearActive, readInstances, removeInstance, resolveInstanceKey } from '../../lib/instance'
import { log, withSpinner } from '../../lib/log'
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
  of the instance's route and tenant reservation, then removes the Instance
  projection. A same-name local bookmark is removed after the delete succeeds
  unless --keep-bookmark is passed.
`,
  arguments: [{ name: 'id', description: 'Instance slug', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--keep-bookmark', description: 'Do not remove a same-name local bookmark' },
  ],
  action: async (id: string, opts: DeleteOpts) => {
    // Teardown walks services + deprovisions — same saga-sized budget as create.
    opts = { ...opts, timeout: opts.timeout ?? '240000' }
    try {
      const result = await withSpinner(
        `Deleting instance ${id}`,
        !isMachine(opts),
        () => deleteOwnedInstance(opts, id),
        { success: (deleted) => `Deleted instance: ${deleted.slug}` },
      )

      if (!opts.keepBookmark) {
        const store = await readInstances()
        const key = resolveInstanceKey(store, id)
        if (key) await removeInstance(key)
      }
      await clearActive(id)

      if (isMachine(opts)) {
        output(result, opts)
        return
      }
    } catch (e) {
      // Bookmark-only id → no admin Instance → kernel NOT_FOUND. Point to
      // `forget` (local drop) instead of surfacing the raw path error.
      if (
        e instanceof AdminInstanceNotFoundError &&
        resolveInstanceKey(await readInstances(), id)
      ) {
        log.error(`No admin-managed instance "${id}".`)
        log.dim(`  hint: it's a local bookmark — drop it with: astrale instance forget ${id}`)
        process.exit(1)
      }
      await formatKernelError(e, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition
