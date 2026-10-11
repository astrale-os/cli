import type { CommandDefinition } from '../../program/index'

import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'
import { syncAstraleSkills } from '../../lib/skills'
import { SKILL_APPLY_MESSAGES } from './configure'

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
      log.success(SKILL_APPLY_MESSAGES[result.status])
    } catch (error) {
      fatal(error, opts)
    }
  },
} satisfies CommandDefinition
