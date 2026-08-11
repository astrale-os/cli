import type { AgentRun } from '../../../shared/types'

import { readJson, writeJson } from '../../state/store'

const LAST_RUN_FILE = '.cache/agent/last-run.json'
const runFile = (id: string) => `.cache/agent/runs/${id}.json`

/** Persist the latest run pointer and, when terminal, its transcript. */
export function persistRun(root: string, run: AgentRun, transcript = false): void {
  try {
    writeJson(root, LAST_RUN_FILE, run)
    if (transcript) writeJson(root, runFile(run.id), run)
  } catch {
    /* run history is best-effort */
  }
}

/** Rehydrate the latest run and reconcile one orphaned by a Studio restart. */
export function readLastRun(domainId: string, root: string): AgentRun | null {
  const last = readJson<AgentRun | null>(root, LAST_RUN_FILE, null)
  if (!last || last.domainId !== domainId) return null
  if (last.status === 'running' || last.status === 'queued') {
    last.status = 'interrupted'
    last.finishedAt = last.finishedAt ?? new Date().toISOString()
    last.error =
      'the studio restarted during this turn — your conversation is preserved; submit again to continue'
    persistRun(root, last)
  }
  return last
}
