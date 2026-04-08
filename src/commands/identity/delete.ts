import type { CommandDefinition } from '../../command'

import { deleteIdentity } from '../../lib/identity'
import { log } from '../../lib/log'

export default {
  name: 'delete',
  description: 'Delete an identity',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  action: async (name: string) => {
    try {
      await deleteIdentity(name)
      log.success(`Deleted identity "${name}"`)
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
} satisfies CommandDefinition
