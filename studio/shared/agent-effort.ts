import type { AgentEffort } from './types'

import { AGENT_EFFORT_LEVELS } from './types'

export function isAgentEffort(value: unknown): value is AgentEffort {
  return AGENT_EFFORT_LEVELS.includes(value as AgentEffort)
}

/** Where a level sits on the shared ladder — the basis of every mapping below. */
export function agentEffortRank(effort: AgentEffort): number {
  return AGENT_EFFORT_LEVELS.indexOf(effort)
}

/**
 * Map a chosen level onto the ladder actually offered, by nearest rung.
 *
 * Every agent — and every MODEL — reports its own ACP ladder, so a level a chat
 * carries may simply not exist where it lands (Claude has no `ultra`, Codex has
 * no `ultracode`, Haiku has no ladder at all). Distance on the shared order is
 * what keeps "the heaviest I asked for" meaning the heaviest available rather
 * than falling back to something arbitrary.
 */
export function effectiveAgentEffort(
  levels: readonly AgentEffort[],
  requested?: string,
): AgentEffort | undefined {
  if (!requested || levels.length === 0) return undefined
  if (!isAgentEffort(requested)) return undefined
  if (levels.includes(requested)) return requested
  const target = agentEffortRank(requested)
  return levels.reduce((closest, level) =>
    Math.abs(agentEffortRank(level) - target) < Math.abs(agentEffortRank(closest) - target)
      ? level
      : closest,
  )
}
