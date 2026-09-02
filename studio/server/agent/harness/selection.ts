/**
 * selection.ts — which agent the studio opens on, and how one is invoked.
 *
 * Nothing selects the agent by itself anymore: the PREFERRED MODEL does, because
 * picking a model is picking an agent. Star one in the composer and every new
 * conversation starts there; star nothing and Studio opens on the harness this
 * machine actually has, each on its own built-in default model.
 *
 * With one exception, and it is the whole reason this file probes anything: a star
 * on an agent that is NOT INSTALLED HERE cannot be honoured. Studio then opens on an
 * agent it can actually run and says so (`source: 'fallback'`) — without touching the
 * setting, so the star comes back on its own the day that agent is installed. Star
 * Opus on your laptop, open the same workspace on a machine with only Codex, and you
 * get Codex there and Opus back home.
 *
 * That preference lives in the studio's settings, which are global — so the harness
 * is too, and neither call below takes a domain root. Invoking one still does: the
 * gateway credentials it runs with are that domain's.
 */
import type { AgentEffort, StudioSettings } from '../../../shared/types'
import type { AgentHarness } from './adapter'

import { studioSettings } from '../../studio-settings'
import { lastKnownPresence } from './adapter'
import { resolveHarnessEnv } from './gateway/config'
import { getHarnessById, hasHarness, listHarnesses } from './registry'

export interface HarnessSelection {
  id: string
  locked: boolean
  source: 'environment' | 'domain' | 'default' | 'fallback'
  /** the starred harness, when it is NOT `id` because it is missing on this machine */
  preferred?: string
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

/** Per-turn overrides a chat carries — each one outranks the domain preference. */
export interface HarnessOverrides {
  model?: string
  effort?: AgentEffort
}

/** The agent Studio names when no probe has anything to say — including none at all. */
const LAST_RESORT = 'claude'

/**
 * The first harness the probes positively answered for, in registry order.
 *
 * Only a `true` counts: a probe that has not run yet, or that threw, leaves the
 * answer `undefined`, and "we have not asked" is not "it is not there". Returns
 * nothing when this machine has no agent at all — the one case the GUI has to say
 * out loud rather than quietly pick for.
 */
function installedHarnessId(besides?: string): string | undefined {
  return listHarnesses().find(
    (entry) => entry.id !== besides && lastKnownPresence(entry.id) === true,
  )?.id
}

export function getHarnessSelection(): HarnessSelection {
  const environment = process.env.DOMAIN_STUDIO_HARNESS?.trim().toLowerCase()
  if (environment && hasHarness(environment))
    return { id: environment, locked: true, source: 'environment' }
  const preferred = studioSettings().agentModel?.harness
  if (preferred && hasHarness(preferred)) {
    // Absent, and something else answered: run what this machine has. The setting
    // keeps the star, so this reverts by itself once the probe finds the agent.
    if (lastKnownPresence(preferred) === false) {
      const substitute = installedHarnessId(preferred)
      if (substitute) return { id: substitute, locked: false, source: 'fallback', preferred }
      // Nothing answered anywhere. Stay on the star rather than invent a second
      // wrong answer — `harnesses` in the status says no agent is installed.
    }
    return { id: preferred, locked: false, source: 'domain' }
  }
  return { id: installedHarnessId() ?? LAST_RESORT, locked: false, source: 'default' }
}

export function getHarness(): AgentHarness {
  return getHarnessById(getHarnessSelection().id)
}

/**
 * Resolve one adapter and every option used to invoke it.
 *
 * `overrides` are the chat's own picks: each tab may run a different model and a
 * different reasoning level, and only falls back to the domain's starred model
 * when it pins none. An unpinned EFFORT stays unpinned all the way down — the
 * agent then runs at whatever level its own configuration is set to.
 */
export async function resolveHarnessConfiguration(
  root: string,
  harness = getHarness(),
  overrides?: HarnessOverrides,
): Promise<HarnessConfigurationResult> {
  const settings = studioSettings()
  const preferred = settings.agentModel
  const model =
    overrides?.model?.trim() ||
    (preferred?.harness === harness.id ? preferred.model.trim() : '') ||
    harness.defaultModel ||
    undefined
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
      ...(overrides?.effort ? { effort: overrides.effort } : {}),
      env: environment.env,
    },
  }
}
