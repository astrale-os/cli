import type { CommandDefinition } from '../../program/index'

import { readInstances, removeInstance, resolveInstanceKey } from '../../lib/instance'
import { fatal, log } from '../../lib/log'

export default {
  name: 'forget',
  description: 'Drop a bookmark reference (never destructive kernel-side)',
  afterHelpText: `
Behavior:
  Drops a bookmark reference only — never touches the remote kernel.
  To destructively remove an admin-managed instance use \`astrale instance delete\`.
`,
  arguments: [{ name: 'name', description: 'Bookmark name (slug or name)', required: true }],
  action: async (name: string) => {
    try {
      const store = await readInstances()
      const key = resolveInstanceKey(store, name)
      if (!key) fatal(new Error(`Instance "${name}" not found`))
      await removeInstance(key!)
      log.success(`Forgot bookmark "${name}" (no kernel-side change)`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
