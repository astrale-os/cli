import {
  AGENT_ACCESS_LEVELS,
  AGENT_EFFORT_LEVELS,
  type AgentEvent,
  type AgentPromptSnapshot,
  type AgentRun,
  type MergeResult,
} from '../../../shared/types'
import { asBoolean, asFiniteNumber, asJsonRecord, asString, asStringArray } from '../../json'
import { listState, readJson, writeJson } from '../../state/store'

const LAST_RUN_FILE = '.cache/agent/last-run.json'
const RUNS_DIR = '.cache/agent/runs'
const runFile = (id: string) => `${RUNS_DIR}/${id}.json`

const RUN_STATUSES = new Set<AgentRun['status']>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'interrupted',
])
const EVENT_KINDS = new Set<AgentEvent['kind']>([
  'status',
  'thinking',
  'message',
  'tool',
  'reply',
  'error',
])

function decodeAgentEvent(value: unknown): AgentEvent | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const ts = asString(record?.ts)
  const kind = asString(record?.kind)
  const text = asString(record?.text)
  if (!id || !ts || !kind || !EVENT_KINDS.has(kind as AgentEvent['kind']) || text === undefined)
    return undefined
  const tool = asString(record?.tool)
  const target = asString(record?.target)
  const commentId = asString(record?.commentId)
  return {
    id,
    ts,
    kind: kind as AgentEvent['kind'],
    text,
    ...(tool === undefined ? {} : { tool }),
    ...(target === undefined ? {} : { target }),
    ...(commentId === undefined ? {} : { commentId }),
  }
}

function decodeMergeResult(value: unknown): MergeResult | undefined {
  const record = asJsonRecord(value)
  const merged = asFiniteNumber(record?.merged)
  const closed = asFiniteNumber(record?.closed)
  const unknownIds = asStringArray(record?.unknownIds)
  const schemaMismatch = asBoolean(record?.schemaMismatch)
  if (
    merged === undefined ||
    !Number.isInteger(merged) ||
    closed === undefined ||
    !Number.isInteger(closed) ||
    !unknownIds ||
    schemaMismatch === undefined
  ) {
    return undefined
  }
  const pastedSchemaVersion = asString(record?.pastedSchemaVersion)
  return {
    merged,
    closed,
    unknownIds,
    schemaMismatch,
    ...(pastedSchemaVersion === undefined ? {} : { pastedSchemaVersion }),
  }
}

function decodePrompt(value: unknown): AgentPromptSnapshot | undefined {
  const record = asJsonRecord(value)
  const createdAt = asString(record?.createdAt)
  const systemPrompt = asString(record?.systemPrompt)
  const turnPrompt = asString(record?.turnPrompt)
  const firstTurn = asBoolean(record?.firstTurn)
  const resumed = asBoolean(record?.resumed)
  const mcpTools = asStringArray(record?.mcpTools)
  if (
    !createdAt ||
    systemPrompt === undefined ||
    turnPrompt === undefined ||
    firstTurn === undefined ||
    resumed === undefined ||
    !mcpTools
  ) {
    return undefined
  }
  const sessionId = asString(record?.sessionId)
  const model = asString(record?.model)
  const effort = AGENT_EFFORT_LEVELS.find((candidate) => candidate === record?.effort)
  const access = AGENT_ACCESS_LEVELS.find((candidate) => candidate === record?.access)
  return {
    createdAt,
    systemPrompt,
    turnPrompt,
    firstTurn,
    resumed,
    mcpTools,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(access === undefined ? {} : { access }),
  }
}

function decodeAgentRun(value: unknown): AgentRun | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const domainId = asString(record?.domainId)
  const harness = asString(record?.harness)
  const status = asString(record?.status)
  const createdAt = asString(record?.createdAt)
  const summary = asString(record?.summary)
  const targetCommentIds = asStringArray(record?.targetCommentIds)
  if (
    !id ||
    !domainId ||
    !harness ||
    !status ||
    !RUN_STATUSES.has(status as AgentRun['status']) ||
    !createdAt ||
    summary === undefined ||
    !targetCommentIds ||
    !Array.isArray(record?.events)
  ) {
    return undefined
  }
  const events = record.events.flatMap((event) => {
    const decoded = decodeAgentEvent(event)
    return decoded ? [decoded] : []
  })
  const instruction = asString(record.instruction)
  const finishedAt = asString(record.finishedAt)
  const sessionId = asString(record.sessionId)
  const resumed = asBoolean(record.resumed)
  const costUsd = asFiniteNumber(record.costUsd)
  const numTurns = asFiniteNumber(record.numTurns)
  const tokens = asFiniteNumber(record.tokens)
  const error = asString(record.error)
  const liveReplies = asFiniteNumber(record.liveReplies)
  const merge = decodeMergeResult(record.merge)
  const prompt = decodePrompt(record.prompt)
  return {
    id,
    domainId,
    harness,
    status: status as AgentRun['status'],
    createdAt,
    summary,
    targetCommentIds,
    events,
    ...(instruction === undefined ? {} : { instruction }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(resumed === undefined ? {} : { resumed }),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(numTurns === undefined ? {} : { numTurns }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(error === undefined ? {} : { error }),
    ...(liveReplies === undefined ? {} : { liveReplies }),
    ...(merge === undefined ? {} : { merge }),
    ...(prompt === undefined ? {} : { prompt }),
  }
}

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
  const last = readJson(root, LAST_RUN_FILE, decodeAgentRun, null)
  if (!last || last.domainId !== domainId) return null
  if (last.status === 'running' || last.status === 'queued') {
    last.status = 'interrupted'
    last.finishedAt = last.finishedAt ?? new Date().toISOString()
    last.error =
      'the studio restarted during this turn — your conversation is preserved; submit again to continue'
    persistRun(root, last, true)
  }
  return last
}

/**
 * The conversation so far, oldest first: every transcript this domain kept.
 *
 * Only terminal runs are written to `runs/`, so the ACTIVE one is missing here —
 * callers layer it on top (the live run is already streamed to them).
 */
export function readRunHistory(domainId: string, root: string, limit = 40): AgentRun[] {
  const boundedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 40
  const runs: AgentRun[] = []
  for (const file of listState(root, RUNS_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const run = readJson(root, `${RUNS_DIR}/${file}`, decodeAgentRun, null)
      if (run && run.domainId === domainId) runs.push(run)
    } catch {
      // One unreadable transcript must not hide the rest of the conversation.
    }
  }
  runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return runs.slice(-boundedLimit)
}
