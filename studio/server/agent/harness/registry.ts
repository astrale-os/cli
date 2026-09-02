/**
 * registry.ts — the concrete local harness adapters, and the process-level caches
 * they reuse across domains.
 */
import type { AgentHarness } from './adapter'

import { AcpClaudeHarness } from './acp/claude'
import { AcpCodexHarness } from './acp/codex'
import { inspectHarnessHealth } from './adapter'
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

/** All registered harnesses (id + label) — every agent the GUI names. */
export function listHarnesses(selected?: string): { id: string; label: string }[] {
  return Object.entries(harnesses)
    .filter(([id]) => id !== 'mock' || id === selected)
    .map(([id, make]) => ({ id, label: make().label }))
}

/** The boot sweep, kept so everything that needs an answer waits on the same one. */
let sweep: Promise<void> | undefined

/**
 * Ask every real harness whether it is installed, and remember the answers.
 *
 * Started at boot so `lastKnownPresence` has something to say before the first
 * domain is read: a machine with a single agent must open its first chat on that
 * one, and that choice is made synchronously.
 *
 * Memoized because starting it is not enough — `/agent/*` AWAITS it. A first chat
 * is created and persisted on the harness the selection names, so answering that
 * route before the probes land would write a Claude tab onto a machine that only
 * has Codex, and no later probe undoes a tab. One sweep per process; the adapters
 * cache their own handshake, and `harnessStatus` re-probes on every read, so an
 * agent installed after boot is still picked up.
 */
export function probeInstalledHarnesses(): Promise<void> {
  sweep ??= Promise.all(
    listHarnesses().map((entry) =>
      inspectHarnessHealth(getHarnessById(entry.id)).catch(() => undefined),
    ),
  ).then(() => undefined)
  return sweep
}
