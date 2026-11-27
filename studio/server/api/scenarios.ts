/**
 * The Scenarios route: a GET reads every Scenario of the Domain; a write puts one Scenario whole
 * (`put`) or deletes one by its id (`delete`), naming the revision it was made from. Every write
 * answers every Scenario as it now stands; a write that does not decode is refused with what is
 * wrong (400), one made from an older revision is refused as stale (409), and neither changes
 * anything. A write that changes the Scenarios is told to every window (`onWritten`), so each reads
 * them again; a delete of one already gone changes nothing and is told to none.
 */
import type { ScenarioStore } from '../../shared/contracts/scenarios'
import type { JsonRecord } from '../json'

import {
  decodeScenario,
  deleteScenario,
  isScenarioId,
  putScenario,
  readScenarios,
  type ScenarioRefusal,
} from '../state/scenarios'
import { badRequest, json } from './http'

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

function answer(
  stored: { readonly value: ScenarioStore; readonly unchanged?: true } | ScenarioRefusal,
  onWritten: (store: ScenarioStore) => void,
): Response {
  if ('problem' in stored) return badRequest(stored.problem)
  if ('stale' in stored) return json({ error: stored.stale, stale: true }, 409)
  if (!stored.unchanged) onWritten(stored.value)
  return json(stored.value)
}

export function handleScenarioRoute(
  req: Request,
  root: string,
  body: JsonRecord,
  /** told every Scenario as it stands once a write lands */
  onWritten: (store: ScenarioStore) => void = () => {},
): Response {
  if (req.method === 'GET') return json(readScenarios(root))
  if (req.method !== 'POST') return badRequest('GET or POST')
  if (body.action !== 'put' && body.action !== 'delete')
    return badRequest('unknown Scenario action')
  if (!isRevision(body.revision))
    return badRequest('a write names the revision it was made from: 0 for a new Scenario')
  if (body.action === 'put') {
    const scenario = decodeScenario(body.scenario)
    if ('problem' in scenario) return badRequest(scenario.problem)
    return answer(putScenario(root, scenario.value, body.revision), onWritten)
  }
  if (!isScenarioId(body.id)) return badRequest('a delete names the Scenario by its id')
  return answer(deleteScenario(root, body.id, body.revision), onWritten)
}
