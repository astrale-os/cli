import type { CommandDefinition } from '../../program/index'

import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'
import { promptMultiSelect } from '../../lib/prompt'
import { astraleSkillAgents, syncAstraleSkills } from '../../lib/skills'

type ConfigureOpts = RawOutputOpts & { agent?: string[]; yes?: boolean }

export async function chooseAstraleSkillAgents(
  opts: ConfigureOpts = {},
): Promise<string[] | undefined> {
  const agents = await astraleSkillAgents()
  if (opts.agent) return opts.agent
  const interactive =
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    !process.env.CI &&
    !process.argv.includes('--no-prompt') &&
    !process.argv.includes('--ci')
  const defaults = agents
    .filter((agent) => agent.configured || agent.detected)
    .map((agent) => agent.name)
  if (!interactive || opts.yes) return defaults
  const ordered = [...agents].sort(
    (left, right) =>
      Number(right.configured || right.detected) - Number(left.configured || left.detected) ||
      left.displayName.localeCompare(right.displayName),
  )
  return promptMultiSelect(
    'Install Astrale skills for which global agents?',
    ordered.map((agent) => ({
      name: `${agent.displayName}${agent.configured ? ' (configured)' : agent.detected ? ' (detected)' : ''}`,
      value: agent.name,
      checked: agent.configured || agent.detected,
      description: agent.globalSkillsDir,
    })),
  )
}

export default {
  name: 'configure',
  description: 'Choose the global agents that receive Astrale skill links',
  options: [
    { flags: '--agent <name...>', description: 'Select agents explicitly (repeat or list names)' },
    { flags: '--yes', description: 'Use detected/already-configured agents without prompting' },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (opts: ConfigureOpts) => {
    try {
      const selected = await chooseAstraleSkillAgents(opts)
      if (selected === undefined) return
      const result = await syncAstraleSkills({
        agents: selected,
        replaceAgentSelection: true,
      })
      if (isMachine(opts)) {
        output({ ...result, agents: selected, scope: 'global' }, opts)
        return
      }
      log.success('Astrale skills configured globally')
      if (selected.length === 0) log.dim('  canonical only: ~/.agents/skills')
      else log.dim(`  agents: ${selected.join(', ')}`)
    } catch (error) {
      fatal(error, opts)
    }
  },
} satisfies CommandDefinition
