import type { CommandDefinition } from '../../command'

import { setDefault } from '../../lib/identity'
import { fatal, log } from '../../lib/log'

export default {
  name: 'use',
  description: 'Set the active CLI identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  action: async (name: string) => {
    try {
      await setDefault(name)
      log.success(`Active identity set to "${name}"`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
