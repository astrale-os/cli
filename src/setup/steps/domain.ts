import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { SetupStep, StepOutcome } from '../types'

import { log } from '../../lib/log'
import { runInherit } from '../../lib/proc'
import { confirmDefaultYes, promptText } from '../../lib/prompt'
import { SCAFFOLDER } from '../../lib/scaffolder'

/** A scaffolded domain project carries this config at its root. */
function hasDomainProject(): boolean {
  return existsSync(join(process.cwd(), 'astrale.config.ts'))
}

const FIX = `npx "${SCAFFOLDER}" <name>`

/** The npx argv that scaffolds `name`: the shared scaffolder range, no instance. */
export function scaffoldArgs(name: string): string[] {
  return [SCAFFOLDER, name]
}

/**
 * What to run once `name` is scaffolded: deploy `development` (each deploy prints the URL of an
 * immutable deployment), then install that URL on the instance the operator picks. Neither the
 * scaffold nor these steps read the active instance, so `-i` stays an `<instance>` placeholder,
 * as in the scaffolder's own Next note.
 */
export function nextSteps(name: string): string[] {
  return [
    `cd ${name} && pnpm install && pnpm run deploy development`,
    'astrale domain install <url> --direct -i <instance>',
  ]
}

export type DomainSetupDependencies = {
  hasDomainProject: () => boolean
  confirmScaffold: () => Promise<boolean>
  promptName: () => Promise<string | undefined>
  scaffold: (args: string[]) => Promise<number>
}

const defaultDependencies: DomainSetupDependencies = {
  hasDomainProject,
  confirmScaffold: () => confirmDefaultYes('Scaffold a new domain project here?'),
  promptName: () =>
    promptText('Domain project name', {
      default: 'my-domain',
      validate: (v) =>
        /^[a-z0-9][a-z0-9-]*$/.test(v) ? true : 'Use a lowercase name like my-domain',
    }),
  scaffold: (args) => runInherit('npx', args),
}

export async function ensureDomainProject(
  deps: DomainSetupDependencies = defaultDependencies,
): Promise<StepOutcome> {
  if (deps.hasDomainProject()) {
    log.success('Domain project already in this directory')
    return 'unchanged'
  }

  if (!(await deps.confirmScaffold())) {
    log.dim(`  Skipped — scaffold later: ${FIX}`)
    return 'skipped'
  }

  const name = await deps.promptName()
  if (!name) {
    log.dim('  Skipped — no name given.')
    return 'skipped'
  }

  const args = scaffoldArgs(name)
  log.step(`npx "${SCAFFOLDER}" ${name}`)
  if ((await deps.scaffold(args)) !== 0) {
    log.warn('Scaffold failed — see the output above.')
    return 'failed'
  }

  log.success(`Domain scaffolded → ./${name}`)
  const [deploy, install] = nextSteps(name)
  log.dim(`  Next: ${deploy}`)
  log.dim(`  Then: ${install}   # the URL the deploy prints`)
  return 'fixed'
}

/**
 * Equip — scaffold a first domain in the current directory via
 * `create-astrale-domain`. The scaffold names no instance; the Next steps
 * deploy it and install the printed URL on an instance. The scaffold
 * also ships the astrale-domain authoring skill, so this covers that skill too.
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

  ensure: () => ensureDomainProject(),
}
