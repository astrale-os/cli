import type { CommandDefinition } from '../../program/index'

import { deleteIdentity } from '../../lib/identity'
import { fatal, log } from '../../lib/log'

export default {
  name: 'delete',
  description: 'Delete an identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  action: async (name: string) => {
    try {
      await deleteIdentity(name)
      log.success(`Deleted identity "${name}"`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
