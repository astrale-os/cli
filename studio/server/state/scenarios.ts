/**
 * scenarios.ts — a Domain's Scenarios, every dataset's, kept in its Studio state
 * (`scenarios.json`) through the allow-listed store. A write puts one Scenario whole or deletes
 * one, names the revision it was made from, and answers every Scenario as it now stands. What a
 * write carries is decoded strictly and a refusal says why. The file is read whole or not at all
 * (state-file.ts): a Scenario this Studio does not decode makes it unreadable, said as such, and
 * no write goes over it; a key it does not know is kept. Another home — a Domain file — replaces
 * this module alone: the route and the client speak the contract, not the file.
 */
import type {
  Scenario,
  ScenarioAct,
  ScenarioEdge,
  ScenarioStep,
  ScenarioStore,
} from '../../shared/contracts/scenarios'

import { SCENARIO_ID, SCENARIO_LIMITS } from '../../shared/contracts/scenarios'
import { asJsonRecord, asString, refused, type Decoded, type JsonRecord } from '../json'
import { changeStateFile, stateOf, type Shape, type StateFile } from './state-file'

export const isScenarioId = (value: unknown): value is string =>
  typeof value === 'string' && SCENARIO_ID.test(value)

/** A path, a relationship, a function key or a module path: a non-empty string of bounded length. */
const isReference = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= SCENARIO_LIMITS.reference

function decodeEdge(value: unknown): ScenarioEdge | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const { from, relation, to } = record
  return isReference(from) && isReference(relation) && isReference(to)
    ? { from, relation, to }
    : undefined
}

/** `{ node }` or, where an Edge is allowed, `{ edge }`; nothing else. */
function decodeOn(
  value: unknown,
  allows: 'node' | 'edge' | 'either',
): { node: string } | { edge: ScenarioEdge } | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  if (allows !== 'edge' && isReference(record.node)) return { node: record.node }
  if (allows === 'node') return undefined
  const edge = decodeEdge(record.edge)
  return edge ? { edge } : undefined
}

function decodeAct(record: JsonRecord, at: string): Decoded<ScenarioAct> {
  if (record.does === 'read') {
    const on = decodeOn(record.on, 'either')
    if (!on)
      return refused(`${at} reads a Node by its path or an Edge by its ends and relationship`)
    return { value: { does: 'read', on } }
  }
  if (record.does === 'traverse') {
    const on = decodeOn(record.on, 'edge')
    if (!on || !('edge' in on))
      return refused(`${at} traverses an Edge by its ends and relationship`)
    return { value: { does: 'traverse', on } }
  }
  if (record.does === 'call') {
    if (!isReference(record.fn)) return refused(`${at} calls a function by its handler key`)
    if (record.on === undefined) return { value: { does: 'call', fn: record.fn } }
    const on = decodeOn(record.on, 'node')
    if (!on || !('node' in on)) return refused(`${at} calls on a Node by its path, or on none`)
    return { value: { does: 'call', fn: record.fn, on } }
  }
  return refused(`${at} reads, traverses or calls`)
}

function decodeStep(value: unknown, at: string): Decoded<ScenarioStep> {
  const record = asJsonRecord(value)
  if (!record) return refused(`${at} is not a step`)
  if (!isScenarioId(record.id)) return refused(`${at} has no id`)
  if (!isReference(record.as)) return refused(`${at} names no one acting`)
  if (record.expect !== 'allowed' && record.expect !== 'refused')
    return refused(`${at} expects allowed or refused`)
  const act = decodeAct(record, at)
  if ('problem' in act) return act
  const note = asString(record.note)?.trim()
  if (record.note !== undefined && note === undefined) return refused(`${at}'s note is not text`)
  if (note !== undefined && note.length > SCENARIO_LIMITS.note)
    return refused(`${at}'s note is longer than ${SCENARIO_LIMITS.note} characters`)
  return {
    value: {
      id: record.id,
      as: record.as,
      ...act.value,
      expect: record.expect,
      ...(note ? { note } : {}),
    },
  }
}

/** A Scenario as a write carries it, or why it is refused. */
export function decodeScenario(value: unknown): Decoded<Scenario> {
  const record = asJsonRecord(value)
  if (!record) return refused('a Scenario is an object')
  if (!isScenarioId(record.id)) return refused('a Scenario names its id')
  if (!isReference(record.dataset)) return refused('a Scenario names its dataset')
  const name = asString(record.name)?.trim()
  if (!name) return refused('a Scenario has a name')
  if (name.length > SCENARIO_LIMITS.name)
    return refused(`a Scenario's name is at most ${SCENARIO_LIMITS.name} characters`)
  if (!Array.isArray(record.steps)) return refused('a Scenario lists its steps')
  if (record.steps.length > SCENARIO_LIMITS.steps)
    return refused(`a Scenario holds at most ${SCENARIO_LIMITS.steps} steps`)
  const steps: ScenarioStep[] = []
  const ids = new Set<string>()
  for (const [index, candidate] of record.steps.entries()) {
    const step = decodeStep(candidate, `step ${index + 1}`)
    if ('problem' in step) return step
    if (ids.has(step.value.id)) return refused(`step ${index + 1} repeats the id ${step.value.id}`)
    ids.add(step.value.id)
    steps.push(step.value)
  }
  return { value: { id: record.id, dataset: record.dataset, name, steps } }
}

/** A revision as the store counts it: a whole number from 1. */
const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1

/** The store as the file holds it: every Scenario decoded whole, or why not. */
function decodeStore(value: unknown): Decoded<ScenarioStore> {
  const record = asJsonRecord(value)
  if (!record) return refused('it holds no object')
  if (!Array.isArray(record.scenarios)) return refused('it lists no Scenarios')
  const revisions = asJsonRecord(record.revisions ?? {})
  if (!revisions) return refused('its revisions are not a record')
  const scenarios: Scenario[] = []
  const ids = new Set<string>()
  const kept: Record<string, number> = {}
  for (const [index, candidate] of record.scenarios.entries()) {
    const decoded = decodeScenario(candidate)
    const id = asString(asJsonRecord(candidate)?.id)
    const which = `Scenario ${index + 1}${id ? ` (${id})` : ''}`
    if ('problem' in decoded) return refused(`${which}: ${decoded.problem}`)
    if (ids.has(decoded.value.id)) return refused(`${which} repeats the id of another`)
    ids.add(decoded.value.id)
    const revision = revisions[decoded.value.id]
    if (revision !== undefined && !isRevision(revision))
      return refused(`${which} has a revision that is not a whole number from 1`)
    if (revision !== undefined) kept[decoded.value.id] = revision
    scenarios.push(decoded.value)
  }
  return { value: { scenarios, revisions: kept } }
}

const STEP: Shape = {
  record: { id: null, as: null, does: null, on: null, fn: null, expect: null, note: null },
}
const SCENARIO: Shape = {
  record: { id: null, dataset: null, name: null, steps: { list: STEP, by: 'id' } },
}

const SCENARIOS: StateFile<ScenarioStore> = {
  name: 'scenarios.json',
  decode: decodeStore,
  shape: { record: { scenarios: { list: SCENARIO, by: 'id' }, revisions: null } },
  empty: () => ({ scenarios: [], revisions: {} }),
}

/** Every Scenario of the Domain; `UnreadableState` when the file is not read whole. */
export function readScenarios(root: string): ScenarioStore {
  return stateOf(root, SCENARIOS)
}

/** A write refused: what it carries does not hold, or it was made from an older revision. */
export type ScenarioRefusal = { readonly problem: string } | { readonly stale: string }

const stale = (id: string, madeFrom: number, current: number): { stale: string } => ({
  stale:
    current === 0
      ? `Scenario ${id} is no longer there: it was deleted elsewhere after this was made.`
      : `Scenario ${id} changed elsewhere (revision ${current}, this was made from ${madeFrom}).`,
})

/**
 * Puts a Scenario whole: in place of the one with its id, else after every other, made from
 * `madeFrom` (0 for a new one). A new one past `SCENARIO_LIMITS.scenarios` is refused; so is one
 * made from a revision the store has moved past.
 */
export function putScenario(
  root: string,
  scenario: Scenario,
  madeFrom: number,
): { readonly value: ScenarioStore } | ScenarioRefusal {
  let refusal: ScenarioRefusal | undefined
  const value = changeStateFile(root, SCENARIOS, (current) => {
    const at = current.scenarios.findIndex((one) => one.id === scenario.id)
    const revision = at < 0 ? 0 : (current.revisions[scenario.id] ?? 0)
    if (madeFrom !== revision) {
      refusal = stale(scenario.id, madeFrom, at < 0 ? 0 : Math.max(revision, 1))
      return undefined
    }
    if (at < 0 && current.scenarios.length >= SCENARIO_LIMITS.scenarios) {
      refusal = refused(`a Domain keeps at most ${SCENARIO_LIMITS.scenarios} Scenarios`)
      return undefined
    }
    return {
      scenarios:
        at < 0
          ? [...current.scenarios, scenario]
          : current.scenarios.map((one, index) => (index === at ? scenario : one)),
      revisions: { ...current.revisions, [scenario.id]: revision + 1 },
    }
  })
  return refusal ?? { value }
}

/**
 * Deletes a Scenario by its id, made from `madeFrom`; one already gone leaves the rest as they
 * are, and says it changed nothing (`unchanged`); one changed since is refused.
 */
export function deleteScenario(
  root: string,
  id: string,
  madeFrom: number,
): { readonly value: ScenarioStore; readonly unchanged?: true } | ScenarioRefusal {
  let refusal: ScenarioRefusal | undefined
  let gone = false
  const value = changeStateFile(root, SCENARIOS, (current) => {
    gone = !current.scenarios.some((one) => one.id === id)
    if (gone) return undefined
    const revision = current.revisions[id] ?? 0
    if (madeFrom !== revision) {
      refusal = stale(id, madeFrom, Math.max(revision, 1))
      return undefined
    }
    const { [id]: _gone, ...revisions } = current.revisions
    return { scenarios: current.scenarios.filter((one) => one.id !== id), revisions }
  })
  return refusal ?? (gone ? { value, unchanged: true } : { value })
}
