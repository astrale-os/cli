import type { AgentHarness } from './types'

import { readJson, writeJson } from '../state/store'
/**
 * agent/registry.ts — registers harness adapters and resolves the per-domain
 * selection. DOMAIN_STUDIO_HARNESS (including `astrale studio --harness`) is a
 * server-wide lock; otherwise each domain persists its own choice.
 */
import { ClaudeCodeHarness } from './claude'
import { CodexHarness } from './codex'
import { MockHarness } from './mock'

const harnesses: Record<string, () => AgentHarness> = {
  claude: () => new ClaudeCodeHarness(),
  codex: () => new CodexHarness(),
  mock: () => new MockHarness(),
}

const instances = new Map<string, AgentHarness>()
const SELECTION_FILE = '.cache/agent/harness.json'

export interface HarnessSelection {
  id: string
  locked: boolean
  source: 'environment' | 'domain' | 'default'
}

export function getHarnessSelection(root: string): HarnessSelection {
  const environment = process.env.DOMAIN_STUDIO_HARNESS?.trim().toLowerCase()
  if (environment && harnesses[environment])
    return { id: environment, locked: true, source: 'environment' }
  const stored = readJson<{ id?: string }>(root, SELECTION_FILE, {})
  const id = stored.id?.toLowerCase()
  if (id && harnesses[id]) return { id, locked: false, source: 'domain' }
  return { id: 'claude', locked: false, source: 'default' }
}

export function setHarnessSelection(root: string, id: string): HarnessSelection {
  const normalized = id.trim().toLowerCase()
  if (!harnesses[normalized] || normalized === 'mock') throw new Error(`unknown harness: ${id}`)
  const current = getHarnessSelection(root)
  if (current.locked)
    throw new Error(`the harness is locked to ${current.id} by DOMAIN_STUDIO_HARNESS / --harness`)
  writeJson(root, SELECTION_FILE, { id: normalized })
  return { id: normalized, locked: false, source: 'domain' }
}

export function getHarness(root: string): AgentHarness {
  const id = getHarnessSelection(root).id
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
