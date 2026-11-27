import { AGENT_ACCESS_LEVELS } from '../../shared/contracts/agent'
import { type AgentModelPreference, type StudioSettings } from '../../shared/contracts/runtime'
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
 *
 * The Studio runs on every key the file holds well, and on the default of the others, so a file
 * edited by hand never stops it. The Settings route reads the file whole or not at all
 * (state-file.ts): a key that does not hold, and the dialog says so with the file's path, and
 * no save goes over it until it is fixed. A key this Studio does not know is kept.
 */
import {
  parseStudioNumericSetting,
  STUDIO_NUMERIC_LIMITS,
  type NumericStudioSetting,
} from '../../shared/settings-values'
import { asJsonRecord, asString, refused, type Decoded, type JsonRecord } from '../json'
import { studioHome } from './home'
import { changeStateFile, stateOf, type StateFile } from './state-file'
import { readJson } from './store'

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

/** Why a key of the file this Studio knows does not hold, or nothing when every one does. */
function settingProblem(record: JsonRecord): string | undefined {
  for (const key of Object.keys(STUDIO_NUMERIC_LIMITS) as NumericStudioSetting[]) {
    if (record[key] === undefined || parseStudioNumericSetting(key, record[key]) !== null) continue
    const { min, max } = STUDIO_NUMERIC_LIMITS[key]
    return `its ${key} is ${JSON.stringify(record[key])}, not a whole number from ${min} to ${max}`
  }
  const { agentAccess, agentModel, integrationsDir } = record
  if (agentAccess !== undefined && !AGENT_ACCESS_LEVELS.some((level) => level === agentAccess))
    return `its agentAccess is ${JSON.stringify(agentAccess)}, not one of ${AGENT_ACCESS_LEVELS.join(', ')}`
  if (integrationsDir !== undefined && typeof integrationsDir !== 'string')
    return 'its integrationsDir is not text'
  if (agentModel !== undefined && agentModel !== null && decodeModelPreference(agentModel) === null)
    return 'its agentModel names no harness and model'
  return undefined
}

function settingsOf(value: unknown): Decoded<Partial<StudioSettings>> {
  const record = asJsonRecord(value)
  if (!record) return refused('it holds no object')
  const problem = settingProblem(record)
  return problem ? refused(problem) : { value: normalizeSettings(record) }
}

const SETTINGS: StateFile<Partial<StudioSettings>> = {
  name: PATH,
  decode: settingsOf,
  shape: {
    record: {
      agentAccess: null,
      agentModel: null,
      integrationsDir: null,
      introspectTimeoutMs: null,
      instancePollMs: null,
      updatesPollMs: null,
      viewProbeTimeoutMs: null,
    },
  },
  empty: () => ({}),
}

function decodeSettings(value: unknown): Partial<StudioSettings> | undefined {
  return asJsonRecord(value) ? normalizeSettings(value) : undefined
}

/**
 * What the Studio runs on: each key the file holds well, the default of the others. Global:
 * there is no domain to ask for.
 */
export function studioSettings(): StudioSettings {
  return { ...DEFAULT_SETTINGS, ...readJson(studioHome(), PATH, decodeSettings, {}) }
}

/** The settings as the file holds them, read whole; `UnreadableState` when it is not. */
export function storedSettings(): StudioSettings {
  return { ...DEFAULT_SETTINGS, ...stateOf(studioHome(), SETTINGS) }
}

/**
 * Saves the values of `patch` that hold; a value that does not is left out. A file not read
 * whole is left as it is: `UnreadableState`.
 */
export function updateStudioSettings(patch: unknown): StudioSettings {
  const next = changeStateFile(studioHome(), SETTINGS, (current) => ({
    ...current,
    ...normalizeSettings(patch),
  }))
  return { ...DEFAULT_SETTINGS, ...next }
}
