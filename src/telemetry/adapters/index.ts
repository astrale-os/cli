/**
 * Harness adapter registry: the set of transcript sources probed for a session,
 * plus a fan-out that runs every detected adapter's discovery and merges the
 * results newest-first. Nothing here throws — a broken adapter degrades to [].
 */
import type { HarnessSession } from '../types'
import type { HarnessAdapter, TimeWindow } from './types'

import { claudeCodeAdapter } from './claude-code'
import { codexAdapter } from './codex'

export type { HarnessAdapter, TimeWindow } from './types'
export { claudeCodeAdapter } from './claude-code'
export { codexAdapter } from './codex'

/** All built-in adapters at their default home-directory bases. */
export function defaultAdapters(): HarnessAdapter[] {
  return [claudeCodeAdapter(), codexAdapter()]
}

function endedMs(s: HarnessSession): number {
  const t = s.endedAt ? Date.parse(s.endedAt) : Number.NaN
  return Number.isNaN(t) ? 0 : t
}

/** Detected adapters' discover() in parallel, flattened, newest endedAt first. */
export async function discoverAll(
  adapters: HarnessAdapter[],
  root: string,
  window: TimeWindow,
): Promise<HarnessSession[]> {
  const active = adapters.filter((a) => {
    try {
      return a.detect()
    } catch {
      return false
    }
  })
  const settled = await Promise.allSettled(active.map((a) => a.discover(root, window)))
  const sessions: HarnessSession[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') sessions.push(...r.value)
  }
  return sessions.sort((a, b) => endedMs(b) - endedMs(a))
}
