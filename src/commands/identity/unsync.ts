import type { CommandDefinition } from '../../program/index'

import { getIdentity, setIdentityMode } from '../../identity/index'
import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'

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
        if (isMachine(opts)) {
          output({ name, mode: identity.mode ?? 'local', unchanged: true }, opts)
          return
        }
        log.warn(`Identity "${name}" is already ${identity.mode ?? 'local'}`)
        return
      }
      await setIdentityMode(name, 'local')
      if (isMachine(opts)) {
        output({ name, mode: 'local' }, opts)
        return
      }
      log.success(`Identity "${name}" → local`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
