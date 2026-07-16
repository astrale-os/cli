/**
 * settings.ts — per-domain power-user overrides for values the studio otherwise
 * hard-codes (first: the integrations/ folder name). Stored at
 * `.domain-studio/settings.json`; missing keys fall back to DEFAULT_SETTINGS.
 * Surfaced subtly in the UI (command palette + a faint gear) for power users.
 */
import { AGENT_ACCESS_LEVELS, AGENT_EFFORT_LEVELS, type StudioSettings } from '../../shared/types'
import { readJson, writeJson } from './store'

const PATH = 'settings.json'

export const DEFAULT_SETTINGS: StudioSettings = {
  agentEffort: 'high',
  agentAccess: 'full',
  agentModels: {},
  integrationsDir: 'integrations',
  introspectTimeoutMs: 20000,
  instancePollMs: 30000,
  updatesPollMs: 600000,
  viewProbeTimeoutMs: 8000,
}

function normalizeSettings(input: Partial<StudioSettings>): Partial<StudioSettings> {
  const out = { ...input }
  if (out.agentEffort !== undefined && !AGENT_EFFORT_LEVELS.includes(out.agentEffort as any))
    delete out.agentEffort
  if (out.agentAccess !== undefined && !AGENT_ACCESS_LEVELS.includes(out.agentAccess as any))
    delete out.agentAccess
  if (out.agentModels !== undefined) {
    if (!out.agentModels || typeof out.agentModels !== 'object' || Array.isArray(out.agentModels)) {
      delete out.agentModels
    } else {
      out.agentModels = Object.fromEntries(
        Object.entries(out.agentModels)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([harness, model]) => [harness.trim().toLowerCase(), model.trim()])
          .filter(([harness, model]) => !!harness && !!model),
      )
    }
  }
  return out
}

export function readSettings(root: string): StudioSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...normalizeSettings(readJson<Partial<StudioSettings>>(root, PATH, {})),
  }
}

export function updateSettings(root: string, patch: Partial<StudioSettings>): StudioSettings {
  const next: StudioSettings = { ...readSettings(root), ...normalizeSettings(patch) }
  writeJson(root, PATH, next)
  return next
}
