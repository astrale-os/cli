import type { CommandDefinition } from '../../program/index'

import { astraleSkillAgents, checkAstraleSkills } from '../../lib/skills'
import { log } from '../../lib/terminal/log'
import {
  isMachine,
  output,
  RAW_OUTPUT_OPTIONS,
  type RawOutputOpts,
} from '../../lib/terminal/output'
import { logSkillCheck } from './configure'

export default {
  name: 'status',
  description: 'Show Astrale skill freshness and configured global agents',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    const [skills, agents] = await Promise.all([checkAstraleSkills(), astraleSkillAgents()])
    const configured = agents.filter((agent) => agent.configured)
    if (isMachine(opts)) {
      output({ skills, agents, scope: 'global' }, opts)
      return
    }
    logSkillCheck(skills)
    log.info('Global agent targets:')
    if (configured.length === 0) log.dim('  canonical only (~/.agents/skills)')
    for (const agent of configured) log.dim(`  ${agent.displayName}  ${agent.globalSkillsDir}`)
  },
} satisfies CommandDefinition
