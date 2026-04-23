import type { CommandDefinition } from '../../command'

import { getIdentity, setIdentityMode } from '../../lib/identity'
import { fatal, log } from '../../lib/log'

/** Metadata-only flip remote → local until cloud sync ships (§2.7). */
export default {
  name: 'unsync',
  description: 'Migrate an identity remote → local (§2.7)',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  action: async (name: string) => {
    try {
      const identity = await getIdentity(name)
      if (identity.mode !== 'remote') {
        log.warn(`Identity "${name}" is already ${identity.mode ?? 'local'}`)
        return
      }
      await setIdentityMode(name, 'local')
      log.success(`Identity "${name}" → local`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
