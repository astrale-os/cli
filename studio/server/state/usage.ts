/**
 * usage.ts — domain-attributable agent spend. Accumulates tokens + USD from THIS
 * studio's own agent runs on THIS domain (not the selected harness's machine-wide
 * usage, which is out of scope here). Stored at
 * `.domain-studio/usage.json`; surfaced read-only in the Settings dialog.
 */
import type { AgentRun, DomainUsage } from '../../shared/types'

import { readJson, writeJson } from './store'

const PATH = 'usage.json'

const EMPTY: DomainUsage = { runs: 0, tokens: 0, costUsd: 0 }

export function readUsage(root: string): DomainUsage {
  return { ...EMPTY, ...readJson<Partial<DomainUsage>>(root, PATH, {}) }
}

/** Fold a finished run into the running total. A run with no reported usage (e.g. it
 *  failed to spawn) is ignored so the count stays meaningful. Best-effort — never
 *  let bookkeeping break a run. */
export function recordRun(root: string, run: AgentRun): void {
  if (run.tokens == null && run.costUsd == null) return
  try {
    const prev = readUsage(root)
    writeJson(root, PATH, {
      runs: prev.runs + 1,
      tokens: prev.tokens + (run.tokens ?? 0),
      costUsd: prev.costUsd + (run.costUsd ?? 0),
      lastRunAt: run.finishedAt ?? new Date().toISOString(),
      lastTokens: run.tokens,
      lastCostUsd: run.costUsd,
    } satisfies DomainUsage)
  } catch {
    /* usage is best-effort */
  }
}
