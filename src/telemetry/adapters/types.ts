/**
 * Harness adapters: discovery + a reading guide, deliberately NOT normalizers.
 * The analyzer is an agent that reads native transcript formats; each adapter
 * only says where sessions live and how to read that format.
 */
import type { HarnessSession } from '../types'

export type TimeWindow = { start: Date; end: Date }

export interface HarnessAdapter {
  name: string
  /** Cheap machine-level presence check (a directory stat, never network). */
  detect(): boolean
  /**
   * Sessions of this harness whose cwd sits at/under `root` and whose activity
   * overlaps `window`. Must never throw — errors degrade to [].
   */
  discover(root: string, window: TimeWindow): Promise<HarnessSession[]>
  /** Prompt fragment: how the analyzer should read this transcript format. */
  readingGuide: string
}
