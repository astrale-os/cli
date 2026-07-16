import type { AgentEffort, HarnessCapabilities } from '../../shared/types'

/** Map a persisted cross-harness setting onto the closest value the selected
 * harness accepts. This matters immediately after switching harnesses, before
 * the user has reopened or saved Settings. */
export function effectiveHarnessEffort(
  capabilities: HarnessCapabilities,
  requested?: AgentEffort,
): AgentEffort | undefined {
  const levels = capabilities.effortLevels
  if (!requested) return undefined
  if (levels.includes(requested)) return requested
  if (requested === 'max' && levels.includes('xhigh')) return 'xhigh'
  if (requested === 'minimal' && levels.includes('low')) return 'low'
  if (levels.includes('high')) return 'high'
  return levels[0]
}
