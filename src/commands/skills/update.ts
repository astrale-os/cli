import type { CommandDefinition } from '../../program/index'

import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'
import { syncAstraleSkills } from '../../lib/skills'

export default {
  name: 'update',
  description: 'Install, update, or repair embedded Astrale skills globally',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    try {
      const result = await syncAstraleSkills()
      if (isMachine(opts)) {
        output({ ...result, scope: 'global' }, opts)
        return
      }
      if (result.status === 'unchanged') log.success('Astrale skills already up to date')
      else if (result.status === 'installed') log.success('Astrale skills installed globally')
      else if (result.status === 'updated') log.success('Astrale skills updated globally')
      else if (result.status === 'repaired') log.success('Astrale skills repaired globally')
    } catch (error) {
      fatal(error, opts)
    }
  },
} satisfies CommandDefinition
