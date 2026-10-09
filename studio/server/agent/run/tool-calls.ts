/**
 * tool-calls.ts - what each tool call of a turn was given and gave back.
 *
 * These details are the heaviest thing a turn produces (a file read whole, a
 * command's full output) and the least read, so they never ride the transcript:
 * a step says where its call stands, and its details are read only when someone
 * opens it. A live run keeps them in memory; a settled one keeps them on disk,
 * one file per run, apart from the transcripts every history read goes through.
 */
import type { AgentRun, AgentToolCall, AgentToolContent } from '../../../shared/types'

import { AGENT_TOOL_STATUSES } from '../../../shared/types'
import { asBoolean, asJsonRecord, asString, asStringArray, decodeEach } from '../../json'
import { readJson, removeState, writeJson } from '../../state/store'

const DIR = 'tool-calls'
const fileOf = (runId: string) => `${DIR}/${runId}.json`
/** Run and event ids are uuids; anything else never names a file. */
const ID = /^[\w-]{1,128}$/

/** A text keeps this much of its head: enough to read what happened, not a file to page through. */
const TEXT_BUDGET = 24_000
/** A raw input or output keeps this much of each string, and this many values overall. */
const VALUE_STRING_BUDGET = 8_000
const VALUE_BUDGET = 400
const VALUE_DEPTH = 8
const CONTENT_LIMIT = 40
const LOCATION_LIMIT = 20

interface RunToolCalls {
  /** the chat the run belongs to - a call is only ever read through its own chat */
  chatId: string
  /** by the id of the event standing for the call */
  calls: Record<string, AgentToolCall>
}

const live = new Map<string, RunToolCalls>()

function clip(text: string, budget = TEXT_BUDGET): { text: string; truncated?: true } {
  return text.length > budget ? { text: text.slice(0, budget), truncated: true } : { text }
}

/**
 * A raw value as JSON would carry it, bounded: long strings keep their head, deep
 * or wide structures stop where the budget does and say so.
 */
export function boundedValue(value: unknown): unknown {
  let spent = 0
  const visit = (current: unknown, depth: number): unknown => {
    spent += 1
    if (typeof current === 'string') {
      if (current.length <= VALUE_STRING_BUDGET) return current
      return `${current.slice(0, VALUE_STRING_BUDGET)}… [${current.length - VALUE_STRING_BUDGET} more characters]`
    }
    if (typeof current === 'number' || typeof current === 'boolean' || current === null)
      return current
    if (typeof current !== 'object') return undefined // not JSON: nothing worth keeping
    if (depth >= VALUE_DEPTH) return '…'
    const list = Array.isArray(current)
    const entries: [string, unknown][] = list
      ? current.map((item, index) => [String(index), item])
      : Object.entries(current)
    const kept: [string, unknown][] = []
    for (let index = 0; index < entries.length; index += 1) {
      if (spent >= VALUE_BUDGET) {
        kept.push(['…', `… [${entries.length - index} more]`])
        break
      }
      const [key, item] = entries[index]!
      const bounded = visit(item, depth + 1)
      // an array keeps its positions; an object drops what JSON would have dropped
      if (bounded !== undefined || list) kept.push([key, bounded ?? null])
    }
    // fromEntries, never assignment: a key named `__proto__` stays a key
    return list ? kept.map(([, item]) => item) : Object.fromEntries(kept)
  }
  return visit(value, 0)
}

function boundedContent(content: AgentToolContent): AgentToolContent {
  switch (content.type) {
    case 'text': {
      const { text, truncated } = clip(content.text)
      return { type: 'text', text, ...(truncated || content.truncated ? { truncated: true } : {}) }
    }
    case 'diff': {
      const before = content.oldText === undefined ? undefined : clip(content.oldText)
      const after = clip(content.newText)
      const truncated = before?.truncated || after.truncated || content.truncated
      return {
        type: 'diff',
        path: content.path,
        ...(before ? { oldText: before.text } : {}),
        newText: after.text,
        ...(truncated ? { truncated: true } : {}),
      }
    }
    case 'resource': {
      const body = content.text === undefined ? undefined : clip(content.text)
      return {
        type: 'resource',
        label: clip(content.label, 500).text,
        ...(body ? { text: body.text } : {}),
        ...(body?.truncated || content.truncated ? { truncated: true } : {}),
      }
    }
  }
}

/** A call as it is kept: every text and value within its budget. */
export function boundToolCall(call: AgentToolCall): AgentToolCall {
  return {
    title: clip(call.title, 2_000).text,
    ...(call.kind === undefined ? {} : { kind: call.kind }),
    ...(call.status === undefined ? {} : { status: call.status }),
    ...(call.input === undefined ? {} : { input: boundedValue(call.input) }),
    content: call.content.slice(0, CONTENT_LIMIT).map(boundedContent),
    ...(call.output === undefined ? {} : { output: boundedValue(call.output) }),
    locations: call.locations.slice(0, LOCATION_LIMIT),
  }
}

/** Keep the latest report of one call of a live run, until the run settles. */
export function recordToolCall(
  run: Pick<AgentRun, 'id' | 'chatId'>,
  eventId: string,
  call: AgentToolCall,
): void {
  let calls = live.get(run.id)
  if (!calls) live.set(run.id, (calls = { chatId: run.chatId, calls: {} }))
  calls.calls[eventId] = boundToolCall(call)
}

/**
 * A run settled: its calls leave memory, for disk when its chat is still open. A
 * closed tab's run keeps nothing - `closeChat` already removed the rest of it.
 */
export function settleToolCalls(root: string, runId: string, keep: boolean): void {
  const calls = live.get(runId)
  live.delete(runId)
  if (!calls || !keep || !ID.test(runId)) return
  try {
    writeJson(root, fileOf(runId), calls)
  } catch {
    /* details are best-effort, like the transcript they belong to */
  }
}

function decodeContent(value: unknown): AgentToolContent | undefined {
  const record = asJsonRecord(value)
  const truncated = asBoolean(record?.truncated) ? { truncated: true as const } : {}
  switch (record?.type) {
    case 'text': {
      const text = asString(record.text)
      return text === undefined ? undefined : { type: 'text', text, ...truncated }
    }
    case 'diff': {
      const path = asString(record.path)
      const newText = asString(record.newText)
      const oldText = asString(record.oldText)
      if (path === undefined || newText === undefined) return undefined
      return {
        type: 'diff',
        path,
        ...(oldText === undefined ? {} : { oldText }),
        newText,
        ...truncated,
      }
    }
    case 'resource': {
      const label = asString(record.label)
      const text = asString(record.text)
      if (label === undefined) return undefined
      return { type: 'resource', label, ...(text === undefined ? {} : { text }), ...truncated }
    }
    default:
      return undefined
  }
}

function decodeToolCall(value: unknown): AgentToolCall | undefined {
  const record = asJsonRecord(value)
  const title = asString(record?.title)
  if (!record || title === undefined) return undefined
  const kind = asString(record.kind)
  const status = AGENT_TOOL_STATUSES.find((candidate) => candidate === record.status)
  return {
    title,
    ...(kind === undefined ? {} : { kind }),
    ...(status === undefined ? {} : { status }),
    ...(record.input === undefined ? {} : { input: record.input }),
    content: decodeEach(record.content, decodeContent) ?? [],
    ...(record.output === undefined ? {} : { output: record.output }),
    locations: asStringArray(record.locations) ?? [],
  }
}

function decodeRunToolCalls(value: unknown): RunToolCalls | undefined {
  const record = asJsonRecord(value)
  const chatId = asString(record?.chatId)
  const calls = asJsonRecord(record?.calls)
  if (!chatId || !calls) return undefined
  return {
    chatId,
    calls: Object.fromEntries(
      Object.entries(calls).flatMap(([eventId, call]) => {
        const kept = decodeToolCall(call)
        return kept ? [[eventId, kept]] : []
      }),
    ),
  }
}

/** One call's details: from memory while its run is live, from disk once it settled. */
export function readToolCall(
  root: string,
  chatId: string,
  runId: string,
  eventId: string,
): AgentToolCall | undefined {
  if (!ID.test(runId) || !ID.test(eventId)) return undefined
  const calls = live.get(runId) ?? readJson(root, fileOf(runId), decodeRunToolCalls, null)
  if (!calls || calls.chatId !== chatId || !Object.hasOwn(calls.calls, eventId)) return undefined
  return calls.calls[eventId]
}

/** Erase the details of runs whose transcripts are going away. */
export function deleteToolCalls(root: string, runIds: readonly string[]): void {
  for (const runId of runIds) {
    live.delete(runId)
    if (!ID.test(runId)) continue
    try {
      removeState(root, fileOf(runId))
    } catch {
      /* best-effort cleanup - the chat row is already gone */
    }
  }
}
