/**
 * chats.ts — the persistent chat tabs of one domain.
 *
 * A domain holds several conversations at once, the way a workspace holds
 * several chats: each tab keeps its own transcript, its own model, its own
 * harness-native session id and its own execution state. Persisted at
 * `.cache/agent/chats.json`, so the tabs survive a Studio restart.
 *
 * The one rule that shapes everything here: a chat's HARNESS is fixed at
 * creation. A Claude session id means nothing to Codex, and a transcript
 * resumed under the other agent would be a different conversation wearing the
 * same name — so switching agent forks a new tab (`forkChat`) carrying a
 * summary of the old one, and leaves the original untouched.
 *
 * Every mutation is a synchronous read-modify-write. That is what keeps two
 * tabs running at once from clobbering each other's row: no `await` sits
 * between the read and the write, so the operation is atomic for this process.
 */
import { randomUUID } from 'node:crypto'

import type { AgentEffort, ChatInfo, ChatStatus, QueuedMessage } from '../../shared/types'

import { isAgentEffort } from '../../shared/agent-effort'
import { DEFAULT_CHAT_TITLE } from '../../shared/types'
import { asBoolean, asFiniteNumber, asJsonRecord, asString } from '../json'
import { readJson, writeJson } from '../state/store'

const CHATS_FILE = '.cache/agent/chats.json'
const LEGACY_SESSION_FILE = '.cache/agent/session.json'

/** Enough of the old conversation to orient the next agent, not a re-briefing. */
const MAX_HANDOFF_CHARS = 8000

/**
 * How many messages may wait behind one turn.
 *
 * A queue is a short list you can still read at a glance, not a batch job: past
 * this the enqueue fails loudly rather than growing a backlog nobody reviews.
 */
export const MAX_QUEUED_MESSAGES = 20
const DEFAULT_TITLE = DEFAULT_CHAT_TITLE

/**
 * A summary of another harness's conversation.
 *
 * It outlives its delivery: the harness needs it once, but the chat keeps
 * showing it as its opening chip — it is the only trace of where the work
 * came from.
 */
export interface ChatHandoff {
  fromChatId: string
  fromHarness: string
  createdAt: string
  summary: string
  /** already sent to the harness; a later turn must not repeat it */
  delivered?: boolean
}

export interface StoredChat {
  id: string
  title: string
  harness: string
  model?: string
  effort?: AgentEffort
  sessionId?: string
  turns: number
  createdAt: string
  updatedAt: string
  /** carried over from the chat this one was forked from */
  handoff?: ChatHandoff
  /** messages typed while a turn was running, oldest first */
  queue?: QueuedMessage[]
  /** this chat owns the transcripts written before Studio had tabs (same harness) */
  adoptsLegacyRuns?: boolean
}

export interface ChatStore {
  version: 2
  activeId: string
  chats: StoredChat[]
}

function decodeStoredChat(value: unknown): StoredChat | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const id = asString(record.id)
  const harness = asString(record.harness)
  if (!id || !harness) return undefined
  const turns = asFiniteNumber(record.turns)
  const model = asString(record.model)
  const effort = isAgentEffort(record.effort) ? record.effort : undefined
  const sessionId = asString(record.sessionId)
  const handoff = decodeHandoff(record.handoff)
  const queue = decodeQueue(record.queue)
  const createdAt = asString(record.createdAt) ?? new Date().toISOString()
  return {
    id,
    title: asString(record.title) || DEFAULT_TITLE,
    harness,
    turns: turns !== undefined && Number.isInteger(turns) && turns >= 0 ? turns : 0,
    createdAt,
    updatedAt: asString(record.updatedAt) ?? createdAt,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(handoff ? { handoff } : {}),
    ...(queue.length ? { queue } : {}),
    ...(asBoolean(record.adoptsLegacyRuns) ? { adoptsLegacyRuns: true } : {}),
  }
}

/** Queued messages read back from disk — a malformed entry is dropped, not fatal. */
function decodeQueue(value: unknown): QueuedMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = asJsonRecord(entry)
    const id = asString(record?.id)
    const text = asString(record?.text)
    if (!id || !text) return []
    return [{ id, text, createdAt: asString(record?.createdAt) ?? new Date().toISOString() }]
  })
}

function decodeHandoff(value: unknown): ChatHandoff | undefined {
  const record = asJsonRecord(value)
  const fromChatId = asString(record?.fromChatId)
  const fromHarness = asString(record?.fromHarness)
  const summary = asString(record?.summary)
  if (!fromChatId || !fromHarness || !summary) return undefined
  return {
    fromChatId,
    fromHarness,
    summary,
    createdAt: asString(record?.createdAt) ?? new Date().toISOString(),
    ...(asBoolean(record?.delivered) ? { delivered: true } : {}),
  }
}

function decodeChatStore(value: unknown): ChatStore | undefined {
  const record = asJsonRecord(value)
  if (!record || !Array.isArray(record.chats)) return undefined
  const version = asFiniteNumber(record.version)
  if (version !== 2) throw new Error(`unsupported agent chat store version: ${String(version)}`)
  const chats = record.chats.flatMap((entry) => {
    const chat = decodeStoredChat(entry)
    return chat ? [chat] : []
  })
  return { version: 2, activeId: asString(record.activeId) ?? '', chats }
}

/**
 * Adopt the pre-tabs store: one conversation per harness becomes one tab per
 * harness, each keeping its session id, its turn count AND its transcripts —
 * upgrading Studio must not look like the conversation was lost.
 */
function migrateLegacyChats(root: string): StoredChat[] {
  const legacy = readJson(root, LEGACY_SESSION_FILE, decodeLegacySessions, [])
  return legacy.map(({ harness, sessionId, turns, updatedAt }) => ({
    id: randomUUID(),
    title: DEFAULT_TITLE,
    harness,
    turns,
    createdAt: updatedAt ?? new Date().toISOString(),
    updatedAt: updatedAt ?? new Date().toISOString(),
    adoptsLegacyRuns: true,
    ...(sessionId ? { sessionId } : {}),
  }))
}

interface LegacySession {
  harness: string
  sessionId?: string
  turns: number
  updatedAt?: string
}

function decodeLegacySessions(value: unknown): LegacySession[] | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const read = (harness: string, candidate: unknown): LegacySession[] => {
    const entry = asJsonRecord(candidate)
    if (!entry) return []
    const sessionId = asString(entry.sessionId)
    if (!sessionId) return []
    const turns = asFiniteNumber(entry.turns)
    return [
      {
        harness,
        sessionId,
        turns: turns !== undefined && Number.isInteger(turns) && turns >= 0 ? turns : 0,
        ...(asString(entry.updatedAt) === undefined
          ? {}
          : { updatedAt: asString(entry.updatedAt) }),
      },
    ]
  }
  const versioned = asJsonRecord(record.conversations)
  if (versioned)
    return Object.entries(versioned).flatMap(([harness, entry]) => read(harness, entry))
  const harness = asString(record.harness)
  return harness ? read(harness, record) : []
}

function newChat(harness: string, extra?: Partial<StoredChat>): StoredChat {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: DEFAULT_TITLE,
    harness,
    turns: 0,
    createdAt: now,
    updatedAt: now,
    ...extra,
  }
}

function readStore(root: string): ChatStore {
  const stored = readJson(root, CHATS_FILE, decodeChatStore, null)
  if (stored) return stored
  return { version: 2, activeId: '', chats: migrateLegacyChats(root) }
}

function writeStore(root: string, store: ChatStore): void {
  writeJson(root, CHATS_FILE, store)
}

/**
 * The store, guaranteed to hold at least one chat and a valid `activeId`.
 *
 * Persists whatever it had to repair, so the ids handed out here are the same
 * ones the next read sees — a tab whose id changed under it would lose its
 * transcript.
 */
export function ensureChats(root: string, defaultHarness: string): ChatStore {
  const store = readStore(root)
  const before = JSON.stringify(store)
  if (store.chats.length === 0) store.chats.push(newChat(defaultHarness))
  if (!store.chats.some((chat) => chat.id === store.activeId))
    store.activeId = store.chats[store.chats.length - 1]!.id
  if (JSON.stringify(store) !== before) writeStore(root, store)
  return store
}

export function activeChat(root: string, defaultHarness: string): StoredChat {
  const store = ensureChats(root, defaultHarness)
  return store.chats.find((chat) => chat.id === store.activeId)!
}

/** Resolve a caller-supplied chat id, falling back to the active tab. */
export function resolveChat(
  root: string,
  defaultHarness: string,
  chatId?: string,
): StoredChat | undefined {
  const store = ensureChats(root, defaultHarness)
  if (!chatId) return store.chats.find((chat) => chat.id === store.activeId)
  return store.chats.find((chat) => chat.id === chatId)
}

export function createChat(
  root: string,
  input: {
    harness: string
    title?: string
    model?: string
    effort?: AgentEffort
    handoff?: ChatHandoff
  },
): StoredChat {
  const store = ensureChats(root, input.harness)
  const chat = newChat(input.harness, {
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.handoff
      ? {
          handoff: { ...input.handoff, summary: input.handoff.summary.slice(0, MAX_HANDOFF_CHARS) },
        }
      : {}),
  })
  store.chats.push(chat)
  store.activeId = chat.id
  writeStore(root, store)
  return chat
}

/**
 * Fork `source` onto another harness: a new tab carrying the summary, the source
 * left exactly as it was. The caller supplies the summary because building it
 * means reading the transcript, which this module does not own.
 */
export function forkChat(
  root: string,
  source: StoredChat,
  harness: string,
  summary: string,
  model?: string,
): StoredChat {
  return createChat(root, {
    harness,
    title: source.title === DEFAULT_TITLE ? DEFAULT_TITLE : `${source.title} (${harness})`,
    ...(model ? { model } : {}),
    // how hard you asked this work to be thought about is about the work, not
    // about the agent — it follows, mapped onto whatever ladder it lands on
    ...(source.effort ? { effort: source.effort } : {}),
    handoff: {
      fromChatId: source.id,
      fromHarness: source.harness,
      createdAt: new Date().toISOString(),
      summary,
    },
  })
}

/** Apply `patch` to one chat and stamp `updatedAt`; the harness is never patchable. */
function mutateChat(
  root: string,
  chatId: string,
  patch: (chat: StoredChat) => void,
): StoredChat | undefined {
  const store = readStore(root)
  const chat = store.chats.find((entry) => entry.id === chatId)
  if (!chat) return undefined
  patch(chat)
  chat.updatedAt = new Date().toISOString()
  writeStore(root, store)
  return chat
}

export function renameChat(root: string, chatId: string, title: string): StoredChat | undefined {
  const trimmed = title.trim().slice(0, 80)
  return mutateChat(root, chatId, (chat) => {
    chat.title = trimmed || DEFAULT_TITLE
  })
}

/** Give a still-unnamed tab the shape of its first instruction. */
export function titleChatFromMessage(root: string, chatId: string, message: string): void {
  const summary = message.trim().split('\n')[0]?.trim()
  if (!summary) return
  mutateChat(root, chatId, (chat) => {
    if (chat.title === DEFAULT_TITLE)
      chat.title = summary.length > 48 ? `${summary.slice(0, 48).trimEnd()}…` : summary
  })
}

/**
 * The reasoning level this chat runs at — cleared by an empty string.
 *
 * Unpinned is a real state, not a missing one: the chat then runs at whatever
 * level the agent's own configuration is set to, and follows it if it changes.
 */
export function setChatEffort(
  root: string,
  chatId: string,
  effort: string,
): StoredChat | undefined {
  const level = isAgentEffort(effort) ? effort : undefined
  return mutateChat(root, chatId, (chat) => {
    if (level) chat.effort = level
    else delete chat.effort
  })
}

/** The model override inside the chat's harness — the one thing a tab may re-pick. */
export function setChatModel(root: string, chatId: string, model: string): StoredChat | undefined {
  const trimmed = model.trim()
  return mutateChat(root, chatId, (chat) => {
    if (trimmed) chat.model = trimmed
    else delete chat.model
  })
}

export function setChatSession(
  root: string,
  chatId: string,
  sessionId: string,
): StoredChat | undefined {
  const trimmed = sessionId.trim()
  return mutateChat(root, chatId, (chat) => {
    if (trimmed) chat.sessionId = trimmed
    else delete chat.sessionId
  })
}

export function clearChatSession(root: string, chatId: string): void {
  mutateChat(root, chatId, (chat) => {
    delete chat.sessionId
    chat.turns = 0
  })
}

/** Record one settled turn: the session to resume next time, and the count. */
export function recordChatTurn(
  root: string,
  chatId: string,
  input: { sessionId: string; turns: number },
): void {
  mutateChat(root, chatId, (chat) => {
    chat.sessionId = input.sessionId
    chat.turns = input.turns
  })
}

/** The messages waiting behind this chat's turn, oldest first. */
export function chatQueue(chat: StoredChat): QueuedMessage[] {
  return chat.queue ?? []
}

/**
 * Park a message behind the turn in progress.
 *
 * Appends: a queue you can reorder is only trustworthy if what you add lands
 * where you expect it, which is last. The caller has already resolved the chat
 * and checked `MAX_QUEUED_MESSAGES`, so `undefined` here means the tab closed
 * between the two.
 */
export function enqueueChatMessage(
  root: string,
  chatId: string,
  text: string,
): QueuedMessage | undefined {
  const message: QueuedMessage = {
    id: randomUUID(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
  }
  return mutateChat(root, chatId, (chat) => {
    chat.queue = [...chatQueue(chat), message]
  })
    ? message
    : undefined
}

/**
 * Put a taken message back at the head.
 *
 * The drain removes before it submits, so a submit that could not start has to
 * restore the message where it was — appending it would silently reorder the
 * queue behind the user's back.
 */
export function requeueChatMessage(root: string, chatId: string, message: QueuedMessage): void {
  mutateChat(root, chatId, (chat) => {
    chat.queue = [message, ...chatQueue(chat).filter((entry) => entry.id !== message.id)]
  })
}

/** Remove and return one queued message — the next one to run when unnamed. */
export function takeQueuedMessage(
  root: string,
  chatId: string,
  messageId?: string,
): QueuedMessage | undefined {
  const store = readStore(root)
  const chat = store.chats.find((entry) => entry.id === chatId)
  if (!chat) return undefined
  const queue = chatQueue(chat)
  const taken = messageId ? queue.find((entry) => entry.id === messageId) : queue[0]
  if (!taken) return undefined
  chat.queue = queue.filter((entry) => entry.id !== taken.id)
  chat.updatedAt = new Date().toISOString()
  writeStore(root, store)
  return taken
}

/** Rewrite one queued message in place, keeping its turn in line. */
export function editQueuedMessage(
  root: string,
  chatId: string,
  messageId: string,
  text: string,
): QueuedMessage | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  let edited: QueuedMessage | undefined
  mutateChat(root, chatId, (chat) => {
    chat.queue = chatQueue(chat).map((entry) => {
      if (entry.id !== messageId) return entry
      edited = { ...entry, text: trimmed }
      return edited
    })
  })
  return edited
}

/** Swap a queued message with its neighbour; false at the end it already sits at. */
export function moveQueuedMessage(
  root: string,
  chatId: string,
  messageId: string,
  delta: -1 | 1,
): boolean {
  const store = readStore(root)
  const chat = store.chats.find((entry) => entry.id === chatId)
  if (!chat) return false
  const queue = [...chatQueue(chat)]
  const from = queue.findIndex((entry) => entry.id === messageId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= queue.length) return false
  queue.splice(to, 0, queue.splice(from, 1)[0]!)
  chat.queue = queue
  chat.updatedAt = new Date().toISOString()
  writeStore(root, store)
  return true
}

/** The transferred summary has reached the harness; never send it twice. */
export function markHandoffDelivered(root: string, chatId: string): void {
  mutateChat(root, chatId, (chat) => {
    if (chat.handoff) chat.handoff.delivered = true
  })
}

/** Drop a carried-over summary only while the harness has not received it. */
export function clearChatHandoff(
  root: string,
  chatId: string,
): 'cleared' | 'delivered' | 'missing' {
  const store = readStore(root)
  const chat = store.chats.find((entry) => entry.id === chatId)
  if (!chat?.handoff) return 'missing'
  if (chat.handoff.delivered) return 'delivered'
  delete chat.handoff
  chat.updatedAt = new Date().toISOString()
  writeStore(root, store)
  return 'cleared'
}

/** The briefing still owed to this chat's harness, if any. */
export function pendingHandoff(chat: StoredChat): string | undefined {
  return chat.handoff && !chat.handoff.delivered ? chat.handoff.summary : undefined
}

/** Whether a tab is still open — a closed one must stop accreting state. */
export function chatExists(root: string, chatId: string): boolean {
  return readStore(root).chats.some((chat) => chat.id === chatId)
}

export function setActiveChat(root: string, chatId: string): boolean {
  const store = readStore(root)
  if (!store.chats.some((chat) => chat.id === chatId)) return false
  store.activeId = chatId
  writeStore(root, store)
  return true
}

/** Drop a tab. The last one may go too — the next read seeds a fresh one. */
export function deleteChat(root: string, chatId: string): boolean {
  const store = readStore(root)
  const next = store.chats.filter((chat) => chat.id !== chatId)
  if (next.length === store.chats.length) return false
  store.chats = next
  if (store.activeId === chatId) store.activeId = next[next.length - 1]?.id ?? ''
  writeStore(root, store)
  return true
}

/** Project one stored chat onto the wire shape, with its live status folded in. */
export function chatInfo(chat: StoredChat, status: ChatStatus): ChatInfo {
  return {
    id: chat.id,
    title: chat.title,
    harness: chat.harness,
    turns: chat.turns,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    status,
    queued: chatQueue(chat),
    ...(chat.model === undefined ? {} : { model: chat.model }),
    ...(chat.effort === undefined ? {} : { effort: chat.effort }),
    ...(chat.sessionId === undefined ? {} : { sessionId: chat.sessionId }),
    ...(chat.handoff
      ? {
          origin: {
            chatId: chat.handoff.fromChatId,
            harness: chat.handoff.fromHarness,
            pendingHandoff: !chat.handoff.delivered,
            summary: chat.handoff.summary,
          },
        }
      : {}),
  }
}
