/**
 * catalog.ts — every model the user can pick, across every harness.
 *
 * The composer's picker is one list: the models of the chat's own agent, and
 * the models of the other one, which start a new chat. That makes it the only
 * place Studio has to describe a harness it is NOT currently running — including
 * an uninstalled one, which the picker shows as unavailable rather than hiding.
 *
 * Each entry is a probe of that harness's ACP session, so this leans on the
 * adapters' own short-lived loadout cache; probes run in parallel and one
 * harness failing never hides the other's models.
 */
import type { HarnessModelCatalog } from '../../../shared/types'
import type { AgentHarness } from './adapter'

import { inspectHarnessHealth } from './adapter'
import { getHarnessById, listHarnesses } from './registry'
import { getHarnessSelection, resolveHarnessConfiguration } from './selection'

async function catalogOf(
  root: string,
  harness: AgentHarness,
  signal?: AbortSignal,
): Promise<HarnessModelCatalog> {
  const base = { harness: harness.id, label: harness.label, models: [] }
  const health = await inspectHarnessHealth(harness, signal)
  if (!health.ok)
    return {
      ...base,
      available: false,
      detail: health.detail ?? `${harness.label} is not detected on this machine`,
    }
  if (!harness.loadout)
    return { ...base, available: true, detail: `${harness.label} does not report its models` }

  // The native catalog, deliberately unfiltered by any Studio override: the
  // picker has to show what could be chosen, not what is chosen.
  const configuration = await resolveHarnessConfiguration(root, harness)
  if (!configuration.ok)
    return {
      ...base,
      available: false,
      detail: `model gateway auth failed — ${configuration.error}`,
    }
  const loadout = await harness.loadout(root, {
    env: configuration.configuration.env,
    ...(signal === undefined ? {} : { signal }),
  })
  const models = loadout.models ?? []
  // What a NEW chat of this harness runs: the domain's starred model when the star
  // is on THIS harness (there is only one, across every agent), Studio's default
  // otherwise — `resolveHarnessConfiguration` already ranks those, so the picker's
  // star and the runner never disagree.
  //
  // Each candidate has to still be in the catalog. A domain that starred a slug
  // the agent has since renamed (`opus` → `opus[1m]`) falls through to Studio's
  // default rather than to the agent's own pick: a dead setting should not quietly
  // hand the choice back to whatever that machine happens to be configured with.
  const listed = (id?: string) => (id && models.some((model) => model.id === id) ? id : undefined)
  const preferred =
    listed(configuration.configuration.model) ?? listed(harness.defaultModel) ?? loadout.nativeModel
  return {
    ...base,
    available: loadout.ok,
    models,
    ...(loadout.nativeModel === undefined ? {} : { nativeModel: loadout.nativeModel }),
    ...(preferred === undefined ? {} : { defaultModel: preferred }),
    ...(loadout.ok || loadout.detail === undefined ? {} : { detail: loadout.detail }),
  }
}

/** Every harness the picker offers, each with whatever models it reports. */
export async function readModelCatalog(
  root: string,
  signal?: AbortSignal,
): Promise<HarnessModelCatalog[]> {
  const harnesses = listHarnesses(getHarnessSelection(root).id)
  return Promise.all(
    harnesses.map(async (entry) => {
      const harness = getHarnessById(entry.id)
      try {
        return await catalogOf(root, harness, signal)
      } catch (error) {
        return {
          harness: harness.id,
          label: harness.label,
          available: false,
          detail: error instanceof Error ? error.message : String(error),
          models: [],
        }
      }
    }),
  )
}
