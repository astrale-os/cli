import type { CommandDefinition } from '../../command'

import { removeInstance } from '../../lib/instance'
import { log } from '../../lib/log'

export default {
  name: 'remove',
  description: 'Remove a registered instance',
  arguments: [{ name: 'name', description: 'Instance name', required: true }],
  action: async (name: string) => {
    try {
      await removeInstance(name)
      log.success(`Removed instance "${name}"`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
