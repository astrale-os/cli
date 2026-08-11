import type { AgentEffort, StudioSettings } from '../../../shared/types'
import type { AgentHarness } from './adapter'

import { effectiveAgentEffort } from '../../../shared/agent-effort'
import { readSettings } from '../../state/settings'
import { readJson, writeJson } from '../../state/store'
import { resolveHarnessEnv } from './gateway/config'
import { getHarnessById, hasHarness } from './registry'

const SELECTION_FILE = '.cache/agent/harness.json'

export interface HarnessSelection {
  id: string
  locked: boolean
  source: 'environment' | 'domain' | 'default'
}

export interface HarnessConfiguration {
  harness: AgentHarness
  settings: StudioSettings
  model?: string
  effort?: AgentEffort
  env: Record<string, string>
}

export type HarnessConfigurationResult =
  | { ok: true; configuration: HarnessConfiguration }
  | { ok: false; error: string }

export function getHarnessSelection(root: string): HarnessSelection {
  const environment = process.env.DOMAIN_STUDIO_HARNESS?.trim().toLowerCase()
  if (environment && hasHarness(environment))
    return { id: environment, locked: true, source: 'environment' }
  const stored = readJson<{ id?: string }>(root, SELECTION_FILE, {})
  const id = stored.id?.toLowerCase()
  if (id && hasHarness(id)) return { id, locked: false, source: 'domain' }
  return { id: 'claude', locked: false, source: 'default' }
}

export function setHarnessSelection(root: string, id: string): HarnessSelection {
  const normalized = id.trim().toLowerCase()
  if (!hasHarness(normalized) || normalized === 'mock') throw new Error(`unknown harness: ${id}`)
  const current = getHarnessSelection(root)
  if (current.locked)
    throw new Error(`the harness is locked to ${current.id} by DOMAIN_STUDIO_HARNESS / --harness`)
  writeJson(root, SELECTION_FILE, { id: normalized })
  return { id: normalized, locked: false, source: 'domain' }
}

export function getHarness(root: string): AgentHarness {
  return getHarnessById(getHarnessSelection(root).id)
}

/** Resolve the selected adapter and every per-domain option used to invoke it. */
export async function resolveHarnessConfiguration(
  root: string,
  harness = getHarness(root),
): Promise<HarnessConfigurationResult> {
  const settings = readSettings(root)
  const model = settings.agentModels[harness.id]?.trim() || undefined
  const effort = effectiveAgentEffort(harness.capabilities.effortLevels, settings.agentEffort)
  const environment =
    harness.capabilities.gateway === 'anthropic'
      ? await resolveHarnessEnv(root)
      : { ok: true as const, env: {} }
  if (!environment.ok) return { ok: false, error: environment.error }
  return {
    ok: true,
    configuration: {
      harness,
      settings,
      model,
      effort,
      env: environment.env,
    },
  }
}
