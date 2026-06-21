import type { SetupStep } from '../types'

import { AGENT_BROWSER_REPO } from '../../lib/browser'
import { log } from '../../lib/log'
import { runInherit } from '../../lib/proc'
import { confirmDefaultYes } from '../../lib/prompt'
import { AGENT_BROWSER_SKILL, detectAgentBrowser, detectSkill } from '../../lib/skills'

const FIX = 'npm install -g agent-browser && agent-browser install'
const SKILL_FIX = `npx skills add ${AGENT_BROWSER_REPO} -g`

/**
 * Equip — agent-browser, the tool `astrale browser` drives. Two halves: the
 * third-party binary (a global npm install + one-time engine download, so opt-in
 * and confirmed) and its agent skill (so the harness knows the commands). We
 * track BOTH: a skill that the harness can't load is as broken as a missing
 * binary, so detection requires both, and `ensure` wires a missing skill even
 * when the binary is already present (the "installed but not loaded" gap).
 */
export const agentBrowserStep: SetupStep = {
  id: 'agent-browser',
  title: 'agent-browser',
  group: 'equip',

  async detect() {
    const haveBin = await detectAgentBrowser()
    const haveSkill = detectSkill(AGENT_BROWSER_SKILL).installed
    if (haveBin && haveSkill)
      return { state: 'satisfied', summary: 'agent-browser + skill installed' }
    if (haveBin && !haveSkill) {
      return {
        state: 'gap',
        summary: 'agent-browser installed, but its skill is not loaded by the harness',
        fixHint: SKILL_FIX,
      }
    }
    return { state: 'gap', summary: 'agent-browser not installed', fixHint: FIX }
  },

  async ensure() {
    const haveSkill = () => detectSkill(AGENT_BROWSER_SKILL).installed
    if ((await detectAgentBrowser()) && haveSkill()) {
      log.success('agent-browser already installed')
      return 'unchanged'
    }

    // 1) The binary — third-party global npm + engine download, so confirm it.
    if (!(await detectAgentBrowser())) {
      log.warn(`agent-browser is a third-party global npm package (${AGENT_BROWSER_REPO}).`)
      if (!(await confirmDefaultYes('Install agent-browser globally now?'))) {
        log.dim(`  Skipped — install later: ${FIX} && ${SKILL_FIX}`)
        return 'skipped'
      }

      log.step('npm install -g agent-browser')
      if ((await runInherit('npm', ['install', '-g', 'agent-browser'])) !== 0) {
        log.warn('npm install failed — see the output above.')
        return 'failed'
      }

      log.step('agent-browser install  (downloading the browser engine)')
      if ((await runInherit('agent-browser', ['install'])) !== 0) {
        log.warn('`agent-browser install` failed — re-run it manually.')
        return 'failed'
      }
    }

    // 2) The skill — wire it into the harness so the agent can load it. Runs even
    //    when the binary was already present (the installed-but-not-loaded gap).
    if (!haveSkill()) {
      log.step(`${SKILL_FIX}  (teaches your agent its commands)`)
      if ((await runInherit('npx', ['skills', 'add', AGENT_BROWSER_REPO, '-g', '-y'])) !== 0) {
        log.warn(`Skill install did not complete — run it later: ${SKILL_FIX}`)
        return 'failed'
      }
    }

    log.success('agent-browser ready — drive the GUI with `astrale browser`')
    return 'fixed'
  },
}
