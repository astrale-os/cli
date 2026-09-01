/**
 * selection.ts — which agent the studio opens on, and how one is invoked.
 *
 * Nothing selects the agent by itself anymore: the PREFERRED MODEL does, because
 * picking a model is picking an agent. Star one in the composer and every new
 * conversation starts there; star nothing and Studio opens on the harness this
 * machine actually has, each on its own built-in default model.
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
import { getHarnessById, hasHarness } from './registry'

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

/** Per-turn overrides a chat carries — each one outranks the domain preference. */
export interface HarnessOverrides {
  model?: string
  effort?: AgentEffort
}

/**
 * The agent to fall back on when nothing has been starred.
 *
 * Claude unless the probes say it is precisely the missing one — a machine with
 * only Codex installed must not open on a harness it cannot run.
 */
function installedHarnessId(): string {
  if (lastKnownPresence('claude') === false && lastKnownPresence('codex') === true) return 'codex'
  return 'claude'
}

export function getHarnessSelection(): HarnessSelection {
  const environment = process.env.DOMAIN_STUDIO_HARNESS?.trim().toLowerCase()
  if (environment && hasHarness(environment))
    return { id: environment, locked: true, source: 'environment' }
  const preferred = studioSettings().agentModel?.harness
  if (preferred && hasHarness(preferred)) return { id: preferred, locked: false, source: 'domain' }
  return { id: installedHarnessId(), locked: false, source: 'default' }
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
