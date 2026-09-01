/**
 * settings.ts — power-user overrides for values the studio otherwise hard-codes.
 *
 * These are preferences of the TOOL — how hard the agent thinks, which model it runs,
 * how long extraction may take — not properties of any one domain, and the studio holds
 * several domains at once. So there is ONE file, at the root the studio was pointed at:
 * `<workspace>/.domain-studio/settings.json`. Pointed at a single domain (the common
 * case), that root IS the domain, and the file is the one that was always there.
 *
 * Missing keys fall back to DEFAULT_SETTINGS. Surfaced subtly in the UI (command palette
 * + a faint gear) for power users.
 *
 * This module is the REPOSITORY — read and write a settings.json under a given root. Which
 * root that is is process context, and lives in `server/studio-settings.ts`; production
 * callers go through its `studioSettings()`, tests hold a root of their own.
 */
import {
  parseStudioNumericSetting,
  STUDIO_NUMERIC_LIMITS,
  type NumericStudioSetting,
} from '../../shared/settings-values'
import {
  AGENT_ACCESS_LEVELS,
  type AgentModelPreference,
  type StudioSettings,
} from '../../shared/types'
import { asJsonRecord, asString } from '../json'
import { readJson, writeJson } from './store'

const PATH = 'settings.json'

export const DEFAULT_SETTINGS: StudioSettings = {
  agentAccess: 'full',
  agentModel: null,
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

  const access = AGENT_ACCESS_LEVELS.find((candidate) => candidate === record.agentAccess)
  if (access) out.agentAccess = access

  const integrationsDir = asString(record.integrationsDir)
  if (integrationsDir !== undefined) out.integrationsDir = integrationsDir

  if ('agentModel' in record) out.agentModel = decodeModelPreference(record.agentModel)
  else if ('agentModels' in record) out.agentModel = adoptLegacyModels(record.agentModels)
  return out
}

function decodeModelPreference(value: unknown): AgentModelPreference | null {
  const record = asJsonRecord(value)
  const harness = asString(record?.harness)?.trim().toLowerCase()
  const model = asString(record?.model)?.trim()
  return harness && model ? { harness, model } : null
}

/**
 * Fold a pre-star settings file — one model per harness — onto the single one.
 *
 * Claude wins when both were set: it is the agent Studio opens on, so its entry
 * is the one that described what a new chat actually ran.
 */
function adoptLegacyModels(value: unknown): AgentModelPreference | null {
  const record = asJsonRecord(value)
  if (!record) return null
  const entries = Object.entries(record)
    .map(([harness, model]) => ({
      harness: harness.trim().toLowerCase(),
      model: asString(model)?.trim() ?? '',
    }))
    .filter((entry): entry is AgentModelPreference => !!entry.harness && !!entry.model)
  return entries.find((entry) => entry.harness === 'claude') ?? entries[0] ?? null
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
