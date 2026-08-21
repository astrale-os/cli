/**
 * settings.ts — per-domain power-user overrides for values the studio otherwise
 * hard-codes (first: the integrations/ folder name). Stored at
 * `.domain-studio/settings.json`; missing keys fall back to DEFAULT_SETTINGS.
 * Surfaced subtly in the UI (command palette + a faint gear) for power users.
 */
import {
  parseStudioNumericSetting,
  STUDIO_NUMERIC_LIMITS,
  type NumericStudioSetting,
} from '../../shared/settings-values'
import { AGENT_ACCESS_LEVELS, AGENT_EFFORT_LEVELS, type StudioSettings } from '../../shared/types'
import { asJsonRecord, asString } from '../json'
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

function normalizeSettings(input: unknown): Partial<StudioSettings> {
  const record = asJsonRecord(input)
  if (!record) return {}
  const out: Partial<StudioSettings> = {}
  for (const key of Object.keys(STUDIO_NUMERIC_LIMITS) as NumericStudioSetting[]) {
    const value = parseStudioNumericSetting(key, record[key])
    if (value !== null) out[key] = value
  }

  const effort = AGENT_EFFORT_LEVELS.find((candidate) => candidate === record.agentEffort)
  if (effort) out.agentEffort = effort
  const access = AGENT_ACCESS_LEVELS.find((candidate) => candidate === record.agentAccess)
  if (access) out.agentAccess = access

  const integrationsDir = asString(record.integrationsDir)
  if (integrationsDir !== undefined) out.integrationsDir = integrationsDir

  const models = asJsonRecord(record.agentModels)
  if (models) {
    out.agentModels = Object.fromEntries(
      Object.entries(models)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([harness, model]) => [harness.trim().toLowerCase(), model.trim()])
        .filter(([harness, model]) => !!harness && !!model),
    )
  }
  return out
}

function decodeSettings(value: unknown): Partial<StudioSettings> | undefined {
  return asJsonRecord(value) ? normalizeSettings(value) : undefined
}

export function readSettings(root: string): StudioSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...readJson(root, PATH, decodeSettings, {}),
  }
}

export function updateSettings(root: string, patch: Partial<StudioSettings>): StudioSettings {
  const next: StudioSettings = { ...readSettings(root), ...normalizeSettings(patch) }
  writeJson(root, PATH, next)
  return next
}
