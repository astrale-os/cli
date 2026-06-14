import type { SetupStep } from '../types'

import { AGENT_BROWSER_REPO } from '../../lib/browser'
import { log } from '../../lib/log'
import { runInherit } from '../../lib/proc'
import { confirmDefaultYes } from '../../lib/prompt'
import { AGENT_BROWSER_SKILL, detectAgentBrowser, detectSkill } from '../../lib/skills'

const FIX = 'npm install -g agent-browser && agent-browser install'

/**
 * Equip — agent-browser, the tool `astrale browser` drives. It's a third-party
 * global npm install plus a one-time engine download, so this is opt-in and
 * confirmed (never part of an unattended run). We also offer its agent skill.
 */
export const agentBrowserStep: SetupStep = {
  id: 'agent-browser',
  title: 'agent-browser',
  group: 'equip',

  async detect() {
    if (await detectAgentBrowser()) {
      return { state: 'satisfied', summary: 'agent-browser installed' }
    }
    return { state: 'gap', summary: 'agent-browser not installed', fixHint: FIX }
  },

  async ensure() {
    if (await detectAgentBrowser()) {
      log.success('agent-browser already installed')
      return 'unchanged'
    }

    log.warn(`agent-browser is a third-party global npm package (${AGENT_BROWSER_REPO}).`)
    if (!(await confirmDefaultYes('Install agent-browser globally now?'))) {
      log.dim(`  Skipped — install later: ${FIX}`)
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

    if (!detectSkill(AGENT_BROWSER_SKILL).installed) {
      log.step(`npx skills add ${AGENT_BROWSER_REPO}  (teaches your agent its commands)`)
      await runInherit('npx', ['skills', 'add', AGENT_BROWSER_REPO, '-y'])
    }

    log.success('agent-browser ready — drive the GUI with `astrale browser`')
    return 'fixed'
  },
}
