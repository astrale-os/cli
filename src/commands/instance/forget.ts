import type { CommandDefinition } from '../../program/index'

import { removeInstance } from '../../lib/instance/bookmarks'
import { fatal, log } from '../../lib/terminal/log'

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
      await removeInstance(name)
      log.success(`Forgot bookmark "${name}" (no kernel-side change)`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
