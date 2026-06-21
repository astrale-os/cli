import type { AgentHarness } from './types'

/**
 * agent/registry.ts — picks the active harness. Default is Claude Code; set
 * DOMAIN_STUDIO_HARNESS=mock for the free deterministic stand-in (tests/dev),
 * or =claude explicitly. New harnesses (codex, …) register here.
 */
import { ClaudeCodeHarness } from './claude'
import { MockHarness } from './mock'

const harnesses: Record<string, () => AgentHarness> = {
  claude: () => new ClaudeCodeHarness(),
  mock: () => new MockHarness(),
}

let active: AgentHarness | null = null

export function getHarness(): AgentHarness {
  if (active) return active
  const want = (process.env.DOMAIN_STUDIO_HARNESS || 'claude').toLowerCase()
  const make = harnesses[want] ?? harnesses.claude
  active = make()
  return active
}

/** All registered harnesses (id + label) — for the (currently locked) UI selector. */
export function listHarnesses(): { id: string; label: string }[] {
  return Object.entries(harnesses).map(([id, make]) => ({ id, label: make().label }))
}
