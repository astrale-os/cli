/**
 * usage.ts — agent spend attributable to Studio's own runs on this machine.
 * Accumulates tokens + USD (not the harness's complete machine-wide usage, which is
 * out of scope here). Stored as `usage.json` beside the global chats in the Studio
 * home; surfaced read-only in the Settings dialog.
 */
import type { AgentRun, AgentUsage } from '../../../shared/contracts/agent'

import { asJsonRecord, refused, type Decoded } from '../../json'
import { changeStateFile, stateOf, type StateFile } from '../../state/state-file'

const EMPTY: AgentUsage = { runs: 0, tokens: 0, costUsd: 0 }

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function usageOf(value: unknown): Decoded<AgentUsage> {
  const record = asJsonRecord(value)
  if (!record) return refused('it holds no object')
  const { runs, tokens, costUsd, lastRunAt, lastTokens, lastCostUsd } = record
  if (!isAmount(runs) || !Number.isInteger(runs)) return refused('it counts no runs')
  if (!isAmount(tokens)) return refused('it counts no tokens')
  if (!isAmount(costUsd)) return refused('it counts no cost in USD')
  if (lastRunAt !== undefined && typeof lastRunAt !== 'string')
    return refused('it says when the last run was in no text')
  if (lastTokens !== undefined && !isAmount(lastTokens))
    return refused('its lastTokens is not a count')
  if (lastCostUsd !== undefined && !isAmount(lastCostUsd))
    return refused('its lastCostUsd is not an amount')
  return {
    value: {
      runs,
      tokens,
      costUsd,
      ...(lastRunAt === undefined ? {} : { lastRunAt }),
      ...(lastTokens === undefined ? {} : { lastTokens }),
      ...(lastCostUsd === undefined ? {} : { lastCostUsd }),
    },
  }
}

const USAGE: StateFile<AgentUsage> = {
  name: 'usage.json',
  decode: usageOf,
  shape: {
    record: {
      runs: null,
      tokens: null,
      costUsd: null,
      lastRunAt: null,
      lastTokens: null,
      lastCostUsd: null,
    },
  },
  empty: () => ({ ...EMPTY }),
}

/** The running total; `UnreadableState` when the file is not read whole. */
export function readUsage(root: string): AgentUsage {
  return stateOf(root, USAGE)
}

/** Fold a finished run into the running total. A run with no reported usage (e.g. it
 *  failed to spawn) is ignored so the count stays meaningful. Best-effort — never
 *  let bookkeeping break a run; a total not read whole is left as it is, not restarted. */
export function recordRun(root: string, run: AgentRun): void {
  if (run.tokens == null && run.costUsd == null) return
  try {
    changeStateFile(root, USAGE, (prev) => ({
      runs: prev.runs + 1,
      tokens: prev.tokens + (run.tokens ?? 0),
      costUsd: prev.costUsd + (run.costUsd ?? 0),
      lastRunAt: run.finishedAt ?? new Date().toISOString(),
      ...(run.tokens == null ? {} : { lastTokens: run.tokens }),
      ...(run.costUsd == null ? {} : { lastCostUsd: run.costUsd }),
    }))
  } catch {
    /* usage is best-effort */
  }
}
