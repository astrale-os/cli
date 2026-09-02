import type { StoredChat } from '../chats'

import {
  AGENT_ACCESS_LEVELS,
  AGENT_EFFORT_LEVELS,
  type AgentEvent,
  type AgentPromptSnapshot,
  type AgentRun,
  type MergeResult,
} from '../../../shared/types'
import { asBoolean, asFiniteNumber, asJsonRecord, asString, asStringArray } from '../../json'
import { listState, readJson, removeState, writeJson } from '../../state/store'

/**
 * Transcripts live beside the machine-global chats they belong to in the Studio home:
 * one file per terminal run, and one "last run" pointer per chat.
 */
const RUNS_DIR = 'runs'
const runFile = (id: string) => `${RUNS_DIR}/${id}.json`
const lastRunFile = (chatId: string) => `last-run/${chatId}.json`

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
  const chatId = asString(record?.chatId)
  const harness = asString(record?.harness)
  const status = asString(record?.status)
  const createdAt = asString(record?.createdAt)
  const summary = asString(record?.summary)
  const targetCommentIds = asStringArray(record?.targetCommentIds)
  if (
    !id ||
    !chatId ||
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
    chatId,
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

/** Persist a chat's latest run pointer and, when terminal, its transcript. */
export function persistRun(root: string, run: AgentRun, transcript = false): void {
  try {
    writeJson(root, lastRunFile(run.chatId), run)
    if (transcript) writeJson(root, runFile(run.id), run)
  } catch {
    /* run history is best-effort */
  }
}

/** Rehydrate a chat's latest run and reconcile one orphaned by a Studio restart. */
export function readLastRun(root: string, chat: StoredChat): AgentRun | null {
  const stored = readJson(root, lastRunFile(chat.id), decodeAgentRun, null)
  if (!stored || stored.chatId !== chat.id) return null
  const last: AgentRun = { ...stored }
  if (last.status === 'running' || last.status === 'queued') {
    last.status = 'interrupted'
    last.finishedAt = last.finishedAt ?? new Date().toISOString()
    last.error =
      'the studio restarted during this turn — your conversation is preserved; submit again to continue'
    persistRun(root, last, true)
  }
  return last
}

/** Every stored transcript of one chat, oldest first. */
function chatRuns(root: string, chat: StoredChat): AgentRun[] {
  const runs: AgentRun[] = []
  for (const file of listState(root, RUNS_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const run = readJson(root, `${RUNS_DIR}/${file}`, decodeAgentRun, null)
      if (run && run.chatId === chat.id) runs.push(run)
    } catch {
      // One unreadable transcript must not hide the rest of the conversation.
    }
  }
  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * One chat's conversation so far, oldest first.
 *
 * Only terminal runs are written to `runs/`, so the ACTIVE one is missing here —
 * callers layer it on top (the live run is already streamed to them).
 *
 * The frozen `prompt` of each turn is dropped: it is the largest field by far (the
 * whole handoff markdown) and nothing reads it here — the activity drawer inspects
 * the CURRENT run, which still carries it.
 */
export function readRunHistory(root: string, chat: StoredChat, limit = 40): AgentRun[] {
  const boundedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 40
  return chatRuns(root, chat)
    .slice(-boundedLimit)
    .map(({ prompt: _prompt, ...turn }) => turn)
}

/** The full transcript a fork summarizes — prompts included would be pure weight. */
export function readChatTranscript(root: string, chat: StoredChat): AgentRun[] {
  return chatRuns(root, chat)
}

/** Erase a closed tab's transcripts; a deleted chat leaves nothing to re-read. */
export function deleteChatRuns(root: string, chat: StoredChat): void {
  for (const run of chatRuns(root, chat)) {
    try {
      removeState(root, runFile(run.id))
    } catch {
      /* best-effort cleanup — the chat row is already gone */
    }
  }
  try {
    removeState(root, lastRunFile(chat.id))
  } catch {
    /* as above */
  }
}
