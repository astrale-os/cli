import type { AgentHarness } from './adapter'

/**
 * Register the concrete local harness adapters and reuse their process-level
 * caches across domains.
 */
import { AcpClaudeHarness } from './acp/claude'
import { AcpCodexHarness } from './acp/codex'
import { MockHarness } from './mock/adapter'

const harnesses: Record<string, () => AgentHarness> = {
  claude: () => new AcpClaudeHarness(),
  codex: () => new AcpCodexHarness(),
  mock: () => new MockHarness(),
}

const instances = new Map<string, AgentHarness>()

export function hasHarness(id: string): boolean {
  return !!harnesses[id]
}

export function getHarnessById(id: string): AgentHarness {
  let harness = instances.get(id)
  if (!harness) {
    harness = (harnesses[id] ?? harnesses.claude)()
    instances.set(id, harness)
  }
  return harness
}

/** All registered harnesses (id + label) — for the (currently locked) UI selector. */
export function listHarnesses(selected?: string): { id: string; label: string }[] {
  return Object.entries(harnesses)
    .filter(([id]) => id !== 'mock' || id === selected)
    .map(([id, make]) => ({ id, label: make().label }))
}
