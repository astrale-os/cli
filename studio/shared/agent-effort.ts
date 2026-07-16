import type { AgentEffort } from './types'

/** Map a persisted cross-harness effort onto the selected harness's vocabulary. */
export function effectiveAgentEffort(
  levels: readonly AgentEffort[],
  requested?: string,
): AgentEffort | undefined {
  if (!requested) return undefined
  if (levels.includes(requested as AgentEffort)) return requested as AgentEffort
  if (requested === 'max' && levels.includes('xhigh')) return 'xhigh'
  if (requested === 'ultracode' && levels.includes('xhigh')) return 'xhigh'
  if (requested === 'minimal' && levels.includes('low')) return 'low'
  if (levels.includes('high')) return 'high'
  return levels[0]
}
