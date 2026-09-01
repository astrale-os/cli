/**
 * Where the studio's settings live.
 *
 * `state/settings.ts` knows how to read and write a settings.json under a root; this knows
 * WHICH root — the workspace the studio was pointed at, one file for every domain it
 * holds. That is process context, so it is deliberately not the repository's business.
 */
import type { StudioSettings } from '../shared/types'

import { readSettings } from './state/settings'
import { workspaceRoot } from './workspace-state'

/** The one root studio settings live under. Falls back to the cwd before boot. */
export function settingsRoot(): string {
  return workspaceRoot() || process.cwd()
}

/** The studio's settings. Global: there is no domain to ask for. */
export function studioSettings(): StudioSettings {
  return readSettings(settingsRoot())
}
