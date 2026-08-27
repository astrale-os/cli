import type { SetupStep } from '../types'

import { chooseAstraleSkillAgents } from '../../commands/skills/configure'
import { log } from '../../lib/log'
import { checkAstraleSkills, SKILL_INSTALL_HINT, syncAstraleSkills } from '../../lib/skills'

const FIX = SKILL_INSTALL_HINT

/**
 * Equip — reconcile every Astrale-owned skill embedded in this CLI release.
 * Setup and update deliberately share one owner, so an existence-only setup check
 * can never bless an incomplete or stale global cohort.
 */
export const skillsStep: SetupStep = {
  id: 'skills',
  title: 'Astrale agent skills',
  group: 'equip',

  async detect() {
    const result = await checkAstraleSkills()
    if (result.status === 'current') {
      return { state: 'satisfied', summary: 'Astrale skills are installed and up to date' }
    }
    if (result.status === 'unavailable') {
      return {
        state: 'broken',
        summary: 'Astrale skills could not be verified',
        detail: result.error,
        fixHint: FIX,
      }
    }
    return {
      state: 'gap',
      summary:
        result.status === 'repair-needed'
          ? 'Astrale skills need repair'
          : 'Astrale skills need installation or update',
      fixHint: FIX,
    }
  },

  async ensure(ctx) {
    log.step('Ensuring Astrale agent skills are current and healthy')
    try {
      const agents = ctx.interactive ? await chooseAstraleSkillAgents() : undefined
      if (agents === undefined && ctx.interactive) return 'unchanged'
      const result = await syncAstraleSkills(
        agents === undefined ? {} : { agents, replaceAgentSelection: true },
      )
      if (result.status === 'unchanged') {
        log.success('Astrale skills already up to date')
        return 'unchanged'
      }
      if (result.status === 'installed') log.success('Astrale skills installed')
      else if (result.status === 'updated') log.success('Astrale skills updated')
      else if (result.status === 'repaired') log.success('Astrale skills repaired and updated')
      return 'fixed'
    } catch (error) {
      log.warn(
        `Astrale skills could not be installed safely${error instanceof Error ? `: ${error.message}` : ''}`,
      )
      log.dim(`  Retry: ${FIX}`)
      return 'failed'
    }
  },
}
