/**
 * settings.ts — power-user overrides for values the studio otherwise hard-codes.
 *
 * These are preferences of the TOOL — how hard the agent thinks, which model it runs,
 * how long extraction may take — not properties of any one domain, and the studio holds
 * several domains at once. So there is ONE machine-global file in the studio's home
 * (`~/.astrale/studio`, or under `ASTRALE_HOME`), whatever workspace is open.
 *
 * Missing keys fall back to DEFAULT_SETTINGS. Surfaced subtly in the UI (command palette
 * + a faint gear) for power users.
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
import { studioHome } from './home'
import { readJson, writeJson } from './store'

const PATH = 'settings.json'

const DEFAULT_SETTINGS: StudioSettings = {
  agentAccess: 'full',
  agentModel: null,
  integrationsDir: 'integrations',
  introspectTimeoutMs: 60_000,
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
  return out
}

function decodeModelPreference(value: unknown): AgentModelPreference | null {
  const record = asJsonRecord(value)
  const harness = asString(record?.harness)?.trim().toLowerCase()
  const model = asString(record?.model)?.trim()
  return harness && model ? { harness, model } : null
}

function decodeSettings(value: unknown): Partial<StudioSettings> | undefined {
  return asJsonRecord(value) ? normalizeSettings(value) : undefined
}

/** The studio's settings. Global: there is no domain to ask for. */
export function studioSettings(): StudioSettings {
  return { ...DEFAULT_SETTINGS, ...readJson(studioHome(), PATH, decodeSettings, {}) }
}

export function updateStudioSettings(patch: unknown): StudioSettings {
  const next: StudioSettings = { ...studioSettings(), ...normalizeSettings(patch) }
  writeJson(studioHome(), PATH, next)
  return next
}
