import type { CommandDefinition } from '../../program/index'

import { log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'
import { astraleSkillAgents, checkAstraleSkills } from '../../lib/skills'

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
    if (skills.status === 'current') log.success('Astrale skills are up to date')
    else if (skills.status === 'update-available')
      log.info('Astrale skills are not installed or need an update')
    else if (skills.status === 'repair-needed') log.warn('Astrale skills need repair')
    else log.warn(`Astrale skills could not be checked${skills.error ? `: ${skills.error}` : ''}`)
    log.info('Global agent targets:')
    if (configured.length === 0) log.dim('  canonical only (~/.agents/skills)')
    for (const agent of configured) log.dim(`  ${agent.displayName}  ${agent.globalSkillsDir}`)
  },
} satisfies CommandDefinition
