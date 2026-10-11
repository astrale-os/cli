import type { CommandDefinition } from '../../program/index'

import { getIdentity, setIdentityMode } from '../../identity/index'
import { fatal, log } from '../../lib/terminal/log'
import { outputForMachine, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/terminal/output'

/** Metadata-only flip remote → local until cloud sync ships (§2.7). */
export default {
  name: 'unsync',
  description: 'Migrate an identity remote → local',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (name: string, opts: RawOutputOpts) => {
    try {
      const identity = await getIdentity(name)
      if (identity.mode !== 'remote') {
        if (outputForMachine({ name, mode: identity.mode ?? 'local', unchanged: true }, opts))
          return
        log.warn(`Identity "${name}" is already ${identity.mode ?? 'local'}`)
        return
      }
      await setIdentityMode(name, 'local')
      if (outputForMachine({ name, mode: 'local' }, opts)) return
      log.success(`Identity "${name}" → local`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
