import type { CommandDefinition } from '../../program/index'

import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'
import { promptMultiSelect } from '../../lib/prompt'
import {
  astraleSkillAgents,
  checkAstraleSkills,
  clearSkillOnboardingState,
  offerAstraleSkillInstallation,
  SKILL_CONFIGURE_COMMAND,
  syncAstraleSkills,
  type AstraleSkillAgentStatus,
  type SkillApplyResult,
  type SkillOnboardingSource,
  type SkillOnboardingState,
} from '../../lib/skills'

export type ConfigureOpts = RawOutputOpts & {
  agent?: string[]
  yes?: boolean
  source?: SkillOnboardingSource
  /** Internal override used by parent commands that have their own machine-mode flags. */
  interactive?: boolean
}

export type SkillConfigureOutcome =
  | { status: 'applied'; result: SkillApplyResult; agents: string[] }
  | { status: 'declined'; state: SkillOnboardingState }
  | { status: 'cancelled' | 'not-due' | 'not-interactive' | 'suppressed' }

export function astraleSkillAgentChoices(agents: readonly AstraleSkillAgentStatus[]) {
  return [...agents]
    .sort(
      (left, right) =>
        Number(right.configured || right.detected) - Number(left.configured || left.detected) ||
        left.displayName.localeCompare(right.displayName),
    )
    .map((agent) => ({
      name: `${agent.displayName}${agent.configured ? ' (configured)' : agent.detected ? ' (detected)' : ''}`,
      value: agent.name,
      checked: agent.configured,
      description: agent.globalSkillsDir,
    }))
}

function canPrompt(opts: ConfigureOpts): boolean {
  return (
    opts.interactive !== false &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !opts.yes &&
    !process.env.CI &&
    !process.env.CONTINUOUS_INTEGRATION &&
    !process.argv.includes('--no-prompt') &&
    !process.argv.includes('--ci') &&
    !process.argv.includes('--json') &&
    !process.argv.includes('--raw')
  )
}

export async function chooseAstraleSkillAgents(
  opts: ConfigureOpts = {},
): Promise<string[] | undefined> {
  const agents = await astraleSkillAgents()
  if (opts.agent) return opts.agent
  const configured = agents.filter((agent) => agent.configured).map((agent) => agent.name)
  if (!canPrompt(opts)) {
    return configured.length > 0
      ? configured
      : agents.filter((agent) => agent.detected).map((agent) => agent.name)
  }
  return promptMultiSelect(
    'Install Astrale skills for which global agents?',
    astraleSkillAgentChoices(agents),
  )
}

export async function configureAstraleSkills(
  opts: ConfigureOpts = {},
): Promise<SkillConfigureOutcome> {
  if (opts.source) {
    const skills = await checkAstraleSkills()
    if (skills.installed === undefined) {
      throw new Error(
        `Astrale skills could not be inspected${skills.error ? `: ${skills.error}` : ''}`,
      )
    }
    if (!skills.installed) {
      const offer = opts.yes
        ? ({ status: 'accepted' } as const)
        : await offerAstraleSkillInstallation(opts.source, { interactive: canPrompt(opts) })
      if (offer.status !== 'accepted') return offer
    } else {
      const agents = (await astraleSkillAgents())
        .filter((agent) => agent.configured)
        .map((agent) => agent.name)
      const result = await syncAstraleSkills()
      await clearSkillOnboardingState()
      return { status: 'applied', result, agents }
    }
  }

  const agents = await chooseAstraleSkillAgents(opts)
  if (agents === undefined) return { status: 'cancelled' }
  const result = await syncAstraleSkills({ agents, replaceAgentSelection: true })
  await clearSkillOnboardingState()
  return { status: 'applied', result, agents }
}

export function renderSkillConfigureOutcome(outcome: SkillConfigureOutcome): void {
  if (outcome.status === 'declined' || outcome.status === 'not-interactive') {
    log.dim(`  You can install them later with: ${SKILL_CONFIGURE_COMMAND}`)
    return
  }
  if (outcome.status !== 'applied') return
  if (outcome.result.status === 'unchanged') log.success('Astrale skills already up to date')
  else if (outcome.result.status === 'installed') log.success('Astrale skills installed globally')
  else if (outcome.result.status === 'updated') log.success('Astrale skills updated globally')
  else if (outcome.result.status === 'repaired') log.success('Astrale skills repaired globally')
  if (outcome.agents.length === 0) log.dim('  canonical only: ~/.agents/skills')
  else log.dim(`  agents: ${outcome.agents.join(', ')}`)
}

export default {
  name: 'configure',
  description: 'Choose the global agents that receive Astrale skill links',
  options: [
    { flags: '--agent <name...>', description: 'Select agents explicitly (repeat or list names)' },
    { flags: '--yes', description: 'Use detected/already-configured agents without prompting' },
    {
      flags: '--source <source>',
      description: 'Onboarding trigger',
      choices: ['install', 'reminder', 'update'],
      hidden: true,
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (opts: ConfigureOpts) => {
    try {
      const outcome = await configureAstraleSkills(opts)
      if (isMachine(opts)) {
        output(
          outcome.status === 'applied'
            ? { ...outcome.result, agents: outcome.agents, scope: 'global' }
            : { status: outcome.status, scope: 'global' },
          opts,
        )
        return
      }
      renderSkillConfigureOutcome(outcome)
    } catch (error) {
      fatal(error, opts)
    }
  },
} satisfies CommandDefinition
