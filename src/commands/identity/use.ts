import type { CommandDefinition } from '../../command'

import { setDefault } from '../../lib/identity'
import { log } from '../../lib/log'

export default {
  name: 'use',
  description: 'Set the active CLI identity (§2.5)',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  action: async (name: string) => {
    try {
      await setDefault(name)
      log.success(`Active identity set to "${name}"`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
