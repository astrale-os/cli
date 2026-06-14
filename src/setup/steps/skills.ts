import type { SetupStep } from '../types'

import { log } from '../../lib/log'
import { runInherit } from '../../lib/proc'
import {
  ASTRALE_CLI_SKILL,
  ASTRALE_CLI_SKILL_SOURCE,
  ASTRALE_DOMAIN_SKILL,
  detectSkill,
} from '../../lib/skills'

const FIX = `npx skills add ${ASTRALE_CLI_SKILL_SOURCE}`

/**
 * Equip — the astrale-cli agent skill. We don't reimplement skill installation;
 * we detect presence and delegate to `npx skills add` (the skill package
 * manager). astrale-domain is unpublished — it rides along with every
 * `create-astrale-domain` scaffold (the domain step), so we don't gate on it.
 */
export const skillsStep: SetupStep = {
  id: 'skills',
  title: 'astrale-cli agent skill',
  group: 'equip',

  async detect() {
    if (detectSkill(ASTRALE_CLI_SKILL).installed) {
      return { state: 'satisfied', summary: 'astrale-cli skill installed' }
    }
    return { state: 'gap', summary: 'astrale-cli agent skill not installed', fixHint: FIX }
  },

  async ensure() {
    if (detectSkill(ASTRALE_CLI_SKILL).installed) {
      log.success('astrale-cli skill already installed')
      return 'unchanged'
    }

    log.step(`Installing the astrale-cli skill — ${FIX}`)
    const code = await runInherit('npx', ['skills', 'add', ASTRALE_CLI_SKILL_SOURCE, '-y'])
    if (code !== 0) {
      log.warn(`Skill install did not complete — run it later: ${FIX}`)
      return 'failed'
    }
    log.success('astrale-cli skill installed')
    if (!detectSkill(ASTRALE_DOMAIN_SKILL).installed) {
      log.dim('  astrale-domain ships inside every `create-astrale-domain` scaffold.')
    }
    return 'fixed'
  },
}
