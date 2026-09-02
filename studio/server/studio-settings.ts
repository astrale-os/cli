/**
 * Where the studio's settings live.
 *
 * `state/settings.ts` knows how to read and write a settings.json under a root; this knows
 * WHICH root — the studio's home on this machine, one file whatever workspace is open.
 * They are preferences of the tool (how hard the agent thinks, which model it opens on,
 * how long extraction may take), not properties of a workspace, so they follow the
 * person rather than the folder.
 */
import type { StudioSettings } from '../shared/types'

import { studioHome } from './home'
import { readSettings } from './state/settings'

/** The one root studio settings live under. */
export function settingsRoot(): string {
  return studioHome()
}

/** The studio's settings. Global: there is no domain to ask for. */
export function studioSettings(): StudioSettings {
  return readSettings(settingsRoot())
}
