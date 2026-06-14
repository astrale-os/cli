import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { SetupStep } from '../types'

import { readLocalStatus } from '../../lib/local-status'
import { log } from '../../lib/log'
import { runInherit } from '../../lib/proc'
import { confirmDefaultYes, promptText } from '../../lib/prompt'

/** A scaffolded domain project carries this config at its root. */
function hasDomainProject(): boolean {
  return existsSync(join(process.cwd(), 'astrale.config.ts'))
}

const FIX = 'npx create-astrale-domain <name> --instance <slug>'

/**
 * Equip — scaffold a first domain in the current directory via
 * `create-astrale-domain`, pre-wired to the active instance. The scaffold also
 * ships the astrale-domain authoring skill, so this covers that skill too.
 */
export const domainStep: SetupStep = {
  id: 'domain',
  title: 'Scaffold a domain',
  group: 'equip',

  async detect() {
    if (hasDomainProject()) {
      return { state: 'satisfied', summary: 'domain project detected in this directory' }
    }
    return { state: 'gap', summary: 'no domain project here', fixHint: FIX }
  },

  async ensure() {
    if (hasDomainProject()) {
      log.success('Domain project already in this directory')
      return 'unchanged'
    }

    if (!(await confirmDefaultYes('Scaffold a new domain project here?'))) {
      log.dim(`  Skipped — scaffold later: ${FIX}`)
      return 'skipped'
    }

    const name = await promptText('Domain project name', {
      default: 'my-domain',
      validate: (v) =>
        /^[a-z0-9][a-z0-9-]*$/.test(v) ? true : 'Use a lowercase name like my-domain',
    })
    if (!name) {
      log.dim('  Skipped — no name given.')
      return 'skipped'
    }

    const slug = (await readLocalStatus()).instance?.active
    const args = ['create-astrale-domain', name, ...(slug ? ['--instance', slug] : [])]
    log.step(`npx ${args.join(' ')}`)
    if ((await runInherit('npx', args)) !== 0) {
      log.warn('Scaffold failed — see the output above.')
      return 'failed'
    }

    log.success(`Domain scaffolded → ./${name}`)
    log.dim(`  Next: cd ${name} && pnpm install && pnpm prod`)
    return 'fixed'
  },
}
