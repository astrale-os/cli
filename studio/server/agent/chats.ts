/**
 * chats.ts — the Studio's machine-global persistent chat tabs.
 *
 * The machine holds every conversation: each tab keeps its own transcript,
 * its own model, its own harness-native session id and its own execution state. They
 * are persisted in the studio's home on this machine — ONE FILE PER CHAT, plus one
 * active pointer per scanned workspace — so tabs survive a Studio restart and remain
 * visible from any workspace. Two Studio windows never clobber each other's rows: a
 * write only ever touches the chat it is about.
 *
 * The one rule that shapes everything here: a chat's HARNESS is fixed at
 * creation. A Claude session id means nothing to Codex, and a transcript
 * resumed under the other agent would be a different conversation wearing the
 * same name — so switching agent forks a new tab (`forkChat`) carrying a
 * summary of the old one, and leaves the original untouched.
 *
 * Every mutation is a synchronous read-modify-write of one file: no `await` sits
 * between the read and the write, so the operation is atomic for this process.
 */
import { randomUUID } from 'node:crypto'

import type {
  AgentEffort,
  ChatInfo,
  ChatStatus,
  NewDomainContext,
  QueuedMessage,
} from '../../shared/types'

import { isAgentEffort } from '../../shared/agent-effort'
import { DEFAULT_CHAT_TITLE } from '../../shared/types'
import { asBoolean, asFiniteNumber, asJsonRecord, asString, asStringArray } from '../json'
import { listState, readJson, removeState, writeJson } from '../state/store'

const CHATS_DIR = 'chats'
const chatFile = (id: string) => `${CHATS_DIR}/${id}.json`
const ACTIVE_FILE = 'active-chat.json'

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
  /** the workspace root this conversation was opened in — where its session can resume */
  workspace?: string
  /** the domains the workspace held when the chat opened, by origin */
  origins?: string[]
  /** carried over from the chat this one was forked from */
  handoff?: ChatHandoff
  /** domain this chat was opened to build immediately after scaffolding */
  newDomain?: NewDomainContext
  /** messages typed while a turn was running, oldest first */
  queue?: QueuedMessage[]
}

export interface ChatStore {
  activeId: string
  /** every tab, oldest first */
  chats: StoredChat[]
}

/** What a new chat records about where it was opened. */
export interface ChatSeed {
  workspace?: string
  origins?: string[]
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
  const newDomain = decodeNewDomain(record.newDomain)
  const queue = decodeQueue(record.queue)
  const createdAt = asString(record.createdAt) ?? new Date().toISOString()
  const workspace = asString(record.workspace)
  const origins = asStringArray(record.origins)
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
    ...(workspace ? { workspace } : {}),
    ...(origins?.length ? { origins } : {}),
    ...(handoff ? { handoff } : {}),
    ...(newDomain ? { newDomain } : {}),
    ...(queue.length ? { queue } : {}),
  }
}

function decodeNewDomain(value: unknown): NewDomainContext | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const origin = asString(record?.origin)
  const path = asString(record?.path)
  return id && origin && path ? { id, origin, path } : undefined
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

function decodeActive(value: unknown): string | undefined {
  return asString(asJsonRecord(value)?.activeId)
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

function readChat(root: string, chatId: string): StoredChat | undefined {
  return readJson(root, chatFile(chatId), decodeStoredChat, undefined)
}

function writeChat(root: string, chat: StoredChat): void {
  writeJson(root, chatFile(chat.id), chat)
}

function readActiveId(activeRoot: string): string {
  return readJson(activeRoot, ACTIVE_FILE, decodeActive, '')
}

function writeActiveId(activeRoot: string, activeId: string): void {
  writeJson(activeRoot, ACTIVE_FILE, { activeId })
}

/** Every tab on disk, oldest first — a corrupt file is skipped, not fatal. */
function readChats(root: string): StoredChat[] {
  const chats: StoredChat[] = []
  for (const file of listState(root, CHATS_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const chat = readJson(root, `${CHATS_DIR}/${file}`, decodeStoredChat, undefined)
      if (chat && `${chat.id}.json` === file) chats.push(chat)
    } catch {
      // one unreadable tab must not hide the rest
    }
  }
  return chats.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

function readStore(root: string, activeRoot = root): ChatStore {
  return { activeId: readActiveId(activeRoot), chats: readChats(root) }
}

/**
 * The store, guaranteed to hold at least one chat and a valid `activeId`.
 *
 * Persists whatever it had to repair, so the ids handed out here are the same
 * ones the next read sees — a tab whose id changed under it would lose its
 * transcript.
 */
export function ensureChats(
  root: string,
  defaultHarness: string,
  seed?: ChatSeed,
  activeRoot = root,
): ChatStore {
  const store = readStore(root, activeRoot)
  if (store.chats.length === 0) {
    const chat = newChat(defaultHarness, seedFields(seed))
    writeChat(root, chat)
    store.chats.push(chat)
  }
  if (!store.chats.some((chat) => chat.id === store.activeId)) {
    store.activeId = store.chats[store.chats.length - 1]!.id
    writeActiveId(activeRoot, store.activeId)
  }
  return store
}

function seedFields(seed?: ChatSeed): Partial<StoredChat> {
  return {
    ...(seed?.workspace ? { workspace: seed.workspace } : {}),
    ...(seed?.origins?.length ? { origins: [...seed.origins] } : {}),
  }
}

export function activeChat(
  root: string,
  defaultHarness: string,
  seed?: ChatSeed,
  activeRoot = root,
): StoredChat {
  const store = ensureChats(root, defaultHarness, seed, activeRoot)
  return store.chats.find((chat) => chat.id === store.activeId)!
}

/** Resolve a caller-supplied chat id, falling back to the active tab. */
export function resolveChat(
  root: string,
  defaultHarness: string,
  chatId?: string,
  seed?: ChatSeed,
  activeRoot = root,
): StoredChat | undefined {
  const store = ensureChats(root, defaultHarness, seed, activeRoot)
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
    newDomain?: NewDomainContext
  } & ChatSeed,
  activeRoot = root,
): StoredChat {
  const chat = newChat(input.harness, {
    ...seedFields(input),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.handoff
      ? {
          handoff: { ...input.handoff, summary: input.handoff.summary.slice(0, MAX_HANDOFF_CHARS) },
        }
      : {}),
    ...(input.newDomain ? { newDomain: { ...input.newDomain } } : {}),
  })
  writeChat(root, chat)
  writeActiveId(activeRoot, chat.id)
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
  activeRoot = root,
): StoredChat {
  return createChat(
    root,
    {
      harness,
      title: source.title === DEFAULT_TITLE ? DEFAULT_TITLE : `${source.title} (${harness})`,
      ...(model ? { model } : {}),
      // how hard you asked this work to be thought about is about the work, not
      // about the agent — it follows, mapped onto whatever ladder it lands on
      ...(source.effort ? { effort: source.effort } : {}),
      ...(source.workspace ? { workspace: source.workspace } : {}),
      ...(source.origins ? { origins: source.origins } : {}),
      handoff: {
        fromChatId: source.id,
        fromHarness: source.harness,
        createdAt: new Date().toISOString(),
        summary,
      },
    },
    activeRoot,
  )
}

/** Apply `patch` to one chat and stamp `updatedAt`; the harness is never patchable. */
function mutateChat(
  root: string,
  chatId: string,
  patch: (chat: StoredChat) => void,
): StoredChat | undefined {
  const chat = readChat(root, chatId)
  if (!chat) return undefined
  patch(chat)
  chat.updatedAt = new Date().toISOString()
  writeChat(root, chat)
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
  let taken: QueuedMessage | undefined
  const chat = readChat(root, chatId)
  if (!chat) return undefined
  const queue = chatQueue(chat)
  taken = messageId ? queue.find((entry) => entry.id === messageId) : queue[0]
  if (!taken) return undefined
  chat.queue = queue.filter((entry) => entry.id !== taken!.id)
  chat.updatedAt = new Date().toISOString()
  writeChat(root, chat)
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
  const chat = readChat(root, chatId)
  if (!chat) return false
  const queue = [...chatQueue(chat)]
  const from = queue.findIndex((entry) => entry.id === messageId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= queue.length) return false
  queue.splice(to, 0, queue.splice(from, 1)[0]!)
  chat.queue = queue
  chat.updatedAt = new Date().toISOString()
  writeChat(root, chat)
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
  const chat = readChat(root, chatId)
  if (!chat?.handoff) return 'missing'
  if (chat.handoff.delivered) return 'delivered'
  delete chat.handoff
  chat.updatedAt = new Date().toISOString()
  writeChat(root, chat)
  return 'cleared'
}

/** The briefing still owed to this chat's harness, if any. */
export function pendingHandoff(chat: StoredChat): string | undefined {
  return chat.handoff && !chat.handoff.delivered ? chat.handoff.summary : undefined
}

/** Whether a tab is still open — a closed one must stop accreting state. */
export function chatExists(root: string, chatId: string): boolean {
  return readChat(root, chatId) !== undefined
}

export function setActiveChat(root: string, chatId: string, activeRoot = root): boolean {
  if (!chatExists(root, chatId)) return false
  writeActiveId(activeRoot, chatId)
  return true
}

/** Drop a tab. The last one may go too — the next read seeds a fresh one. */
export function deleteChat(root: string, chatId: string, activeRoot = root): boolean {
  if (!chatExists(root, chatId)) return false
  removeState(root, chatFile(chatId))
  if (readActiveId(activeRoot) === chatId) {
    const remaining = readChats(root)
    writeActiveId(activeRoot, remaining[remaining.length - 1]?.id ?? '')
  }
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
    ...(chat.workspace === undefined ? {} : { workspace: chat.workspace }),
    ...(chat.origins === undefined ? {} : { origins: [...chat.origins] }),
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
    ...(chat.newDomain ? { newDomain: { ...chat.newDomain } } : {}),
  }
}
