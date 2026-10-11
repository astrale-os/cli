/**
 * Harness adapters say where an agent harness keeps its transcripts and how the analyzer should
 * read that native format; they never normalize transcripts.
 */
import type { HarnessSession } from '../types'

import { claudeCodeAdapter } from './claude-code'
import { codexAdapter } from './codex'

export type TimeWindow = { start: Date; end: Date }

export type HarnessAdapter = {
  name: string
  /** Prompt fragment: how the analyzer should read this transcript format. */
  readingGuide: string
  /** Sessions whose cwd sits at or under `root` and whose activity overlaps `window`. */
  discover(root: string, window: TimeWindow): HarnessSession[]
}

export function defaultAdapters(): HarnessAdapter[] {
  return [claudeCodeAdapter(), codexAdapter()]
}

function endedMs(session: HarnessSession): number {
  return Date.parse(session.endedAt ?? '') || 0
}

/** Every adapter's sessions, newest first. A failing adapter contributes nothing. */
export function discoverAll(
  adapters: HarnessAdapter[],
  root: string,
  window: TimeWindow,
): HarnessSession[] {
  return adapters
    .flatMap((adapter) => {
      try {
        return adapter.discover(root, window)
      } catch {
        return []
      }
    })
    .sort((a, b) => endedMs(b) - endedMs(a))
}
