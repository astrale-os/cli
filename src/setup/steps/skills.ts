import type { SetupStep } from '../types'

import { log } from '../../lib/log'
import {
  ASTRALE_CLI_SKILL,
  ASTRALE_DOMAIN_SKILL,
  detectSkill,
  installSkills,
  SKILL_INSTALL_HINT,
} from '../../lib/skills'

const FIX = SKILL_INSTALL_HINT

/**
 * Equip — the astrale agent skills. Both the astrale-cli (ops) and astrale-domain
 * (authoring) skills publish from the one public `astrale-os/cli` repo, so a
 * single `npx skills add astrale-os/cli -g` installs both, globally. We don't
 * reimplement skill installation; we detect presence and delegate to `npx skills
 * add` (the skill package manager). A global (user-level) install equips every
 * project on the machine, so a freshly scaffolded domain has the skills without
 * shipping its own copy.
 */
const bothInstalled = (): boolean =>
  detectSkill(ASTRALE_CLI_SKILL).installed && detectSkill(ASTRALE_DOMAIN_SKILL).installed

export const skillsStep: SetupStep = {
  id: 'skills',
  title: 'astrale agent skills (cli + domain)',
  group: 'equip',

  async detect() {
    if (bothInstalled()) {
      return { state: 'satisfied', summary: 'astrale-cli + astrale-domain skills installed' }
    }
    const have = detectSkill(ASTRALE_CLI_SKILL).installed
      ? 'astrale-domain'
      : 'astrale agent skills'
    return { state: 'gap', summary: `${have} not installed`, fixHint: FIX }
  },

  async ensure() {
    if (bothInstalled()) {
      log.success('astrale-cli + astrale-domain skills already installed')
      return 'unchanged'
    }

    log.step(`Installing the astrale agent skills — ${FIX}`)
    if (!(await installSkills())) {
      log.warn(`Skill install did not complete — run it later: ${FIX}`)
      return 'failed'
    }
    if (bothInstalled()) {
      log.success('astrale-cli + astrale-domain skills installed')
    } else {
      log.success('astrale-cli skill installed')
    }
    return 'fixed'
  },
}
