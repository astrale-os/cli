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
 *
 * A chat file is a state file the Studio changes (state-file.ts): read whole or not
 * at all. One this Studio cannot read whole — not JSON, a value it does not decode
 * (a newer Studio's, one edited by hand) — is left out of the tabs and never written
 * over: a request naming it is refused (`UnreadableState`) with why and where. A key
 * this Studio does not know, on a chat it does read, is kept through every write. The active
 * pointer and the tabs' order are state files too: one not read whole reads as none — the tabs
 * still open, on the newest, in age order — and every write to it is refused. The tab list
 * names every one of these files it leaves out (`unreadableChatFiles`).
 */
import { randomUUID } from 'node:crypto'

import type {
  AgentEffort,
  ChatAttachment,
  ChatInfo,
  ChatStatus,
  NewDomainContext,
  QueuedMessage,
} from '../../shared/contracts/agent'

import { isAgentEffort } from '../../shared/agent-effort'
import { isChatTone, nextChatTone } from '../../shared/chat-tone'
import { DEFAULT_CHAT_TITLE } from '../../shared/contracts/agent'
import {
  asJsonRecord,
  asString,
  asStringArray,
  type Decoded,
  type JsonRecord,
  refused,
  type StrictDecoder,
} from '../json'
import {
  changeStateFile,
  readStateFile,
  type Shape,
  type StateFile,
  stateOf,
  UnreadableState,
} from '../state/state-file'
import { listState, removeState, stateExists, writeJson } from '../state/store'
import { decodeAttachment } from './attachments'

const CHATS_DIR = 'chats'
/** A chat id as this module mints them (a UUID) or a test writes them: never a path. */
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/
const chatFile = (id: string) => `${CHATS_DIR}/${id}.json`
const ACTIVE_FILE = 'active-chat.json'
/** The order the tabs were arranged in, by id; absent until someone drags one. */
const ORDER_FILE = 'chat-order.json'

/** Enough of the old conversation to orient the next agent, not a re-briefing. */
const MAX_HANDOFF_CHARS = 8000

/**
 * How many messages may wait behind one turn.
 *
 * A queue is a short list you can still read at a glance, not a batch job: past
 * this the enqueue fails loudly rather than growing a backlog nobody reviews.
 */
export const MAX_QUEUED_MESSAGES = 20

/**
 * A summary of another harness's conversation.
 *
 * It outlives its delivery: the harness needs it once, but the chat keeps
 * showing it as its opening chip — it is the only trace of where the work
 * came from.
 */
interface ChatHandoff {
  fromChatId: string
  fromHarness: string
  createdAt: string
  summary: string
  /** already sent to the harness; a later turn must not repeat it */
  delivered?: boolean
}

/** A chat as it is stored: the wire shape without its live status, holding its briefing and queue. */
export type StoredChat = Omit<ChatInfo, 'status' | 'queued' | 'origin'> & {
  /** carried over from the chat this one was forked from */
  handoff?: ChatHandoff
  /** messages typed while a turn was running, oldest first */
  queue?: QueuedMessage[]
}

interface ChatStore {
  activeId: string
  /** every tab, in the order the user arranged them, new ones last */
  chats: StoredChat[]
}

/** What a new chat records about where it was opened. */
export type ChatSeed = Pick<StoredChat, 'workspace' | 'origins'>

/** A key a chat may leave out: absent, or `null` as an older Studio may have written it. */
const absent = (value: unknown): value is undefined | null => value === undefined || value === null

/** Each optional string key of `record`, or the one that is not a string. */
function optionalStrings<K extends string>(
  record: JsonRecord,
  keys: readonly K[],
  at: string,
): Decoded<Partial<Record<K, string>>> {
  const found: Partial<Record<K, string>> = {}
  for (const key of keys) {
    const value = record[key]
    if (absent(value)) continue
    if (typeof value !== 'string') return refused(`${at}${key} is not text`)
    found[key] = value
  }
  return { value: found }
}

/**
 * A chat file read whole, or why not: what it leaves out takes its default, and a value it holds
 * that this Studio does not decode refuses it, never dropped on the way to the next write.
 */
function decodeChat(id: string): StrictDecoder<StoredChat> {
  return (value) => {
    const record = asJsonRecord(value)
    if (!record) return refused('it is not a chat')
    if (record.id !== id) return refused(`it does not name chat ${id} as its id`)
    if (typeof record.harness !== 'string' || !record.harness) return refused('it names no harness')
    const strings = optionalStrings(
      record,
      ['title', 'createdAt', 'updatedAt', 'model', 'sessionId', 'workspace'] as const,
      '',
    )
    if ('problem' in strings) return strings
    const { title, createdAt: created, updatedAt, model, sessionId, workspace } = strings.value
    const { turns, tone, effort, fastMode, origins } = record
    if (!absent(turns) && !(Number.isInteger(turns) && (turns as number) >= 0))
      return refused('turns is not a count')
    if (!absent(tone) && !isChatTone(tone)) return refused('tone is not a hue')
    if (!absent(effort) && !isAgentEffort(effort)) return refused('effort is not a reasoning level')
    if (!absent(fastMode) && typeof fastMode !== 'boolean')
      return refused('fastMode is not yes or no')
    if (!absent(origins) && !asStringArray(origins)) return refused('origins is not a list of text')
    const handoff = absent(record.handoff) ? undefined : decodeHandoff(record.handoff)
    if (handoff && 'problem' in handoff) return handoff
    const newDomain = absent(record.newDomain) ? undefined : decodeNewDomain(record.newDomain)
    if (newDomain && 'problem' in newDomain) return newDomain
    const queue = absent(record.queue) ? { value: [] } : decodeQueue(record.queue)
    if ('problem' in queue) return queue
    const createdAt = created ?? new Date().toISOString()
    return {
      value: {
        id,
        title: title || DEFAULT_CHAT_TITLE,
        harness: record.harness,
        turns: typeof turns === 'number' ? turns : 0,
        createdAt,
        updatedAt: updatedAt ?? createdAt,
        ...(isChatTone(tone) ? { tone } : {}),
        ...(model ? { model } : {}),
        ...(isAgentEffort(effort) ? { effort } : {}),
        ...(typeof fastMode === 'boolean' ? { fastMode } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(workspace ? { workspace } : {}),
        ...(Array.isArray(origins) && origins.length
          ? { origins: [...(origins as string[])] }
          : {}),
        ...(handoff ? { handoff: handoff.value } : {}),
        ...(newDomain ? { newDomain: newDomain.value } : {}),
        ...(queue.value.length ? { queue: queue.value } : {}),
      },
    }
  }
}

function decodeNewDomain(value: unknown): Decoded<NewDomainContext> {
  const record = asJsonRecord(value)
  const { id, origin, path } = record ?? {}
  return typeof id === 'string' &&
    id &&
    typeof origin === 'string' &&
    origin &&
    typeof path === 'string' &&
    path
    ? { value: { id, origin, path } }
    : refused('newDomain is not a Domain by id, origin and path')
}

/** The messages waiting behind the turn, each read whole. */
function decodeQueue(value: unknown): Decoded<QueuedMessage[]> {
  if (!Array.isArray(value)) return refused('queue is not a list')
  const queue: QueuedMessage[] = []
  for (const [index, entry] of value.entries()) {
    const at = `queued message ${index + 1}`
    const record = asJsonRecord(entry)
    if (!record) return refused(`${at} is not a message`)
    if (typeof record.id !== 'string' || !record.id) return refused(`${at} has no id`)
    const strings = optionalStrings(record, ['text', 'createdAt'] as const, `${at}'s `)
    if ('problem' in strings) return strings
    const comments = absent(record.comments) ? [] : asStringArray(record.comments)
    if (!comments) return refused(`${at}'s comments are not a list of text`)
    let attachments: ChatAttachment[] = []
    if (!absent(record.attachments)) {
      if (!Array.isArray(record.attachments)) return refused(`${at}'s attachments are not a list`)
      attachments = []
      for (const item of record.attachments) {
        const attachment = decodeAttachment(item)
        if (!attachment)
          return refused(`${at} holds an attachment that is not an image this Studio keeps`)
        attachments.push(attachment)
      }
    }
    const text = strings.value.text ?? ''
    if (!text && attachments.length === 0) return refused(`${at} holds neither text nor an image`)
    queue.push({
      id: record.id,
      text,
      ...(comments.length ? { comments: [...comments] } : {}),
      ...(attachments.length ? { attachments } : {}),
      createdAt: strings.value.createdAt ?? new Date().toISOString(),
    })
  }
  return { value: queue }
}

function decodeHandoff(value: unknown): Decoded<ChatHandoff> {
  const record = asJsonRecord(value)
  if (!record) return refused('handoff is not a summary')
  const strings = optionalStrings(
    record,
    ['fromChatId', 'fromHarness', 'summary', 'createdAt'] as const,
    'handoff ',
  )
  if ('problem' in strings) return strings
  const { fromChatId, fromHarness, summary, createdAt } = strings.value
  if (!fromChatId || !fromHarness || !summary)
    return refused('handoff names no chat, harness or summary')
  if (!absent(record.delivered) && typeof record.delivered !== 'boolean')
    return refused('handoff delivered is not yes or no')
  return {
    value: {
      fromChatId,
      fromHarness,
      summary,
      createdAt: createdAt ?? new Date().toISOString(),
      ...(record.delivered === true ? { delivered: true } : {}),
    },
  }
}

/** Where a chat's known keys are: every other key, another Studio's, is kept through a write. */
const CHAT_SHAPE: Shape = {
  record: {
    id: null,
    title: null,
    harness: null,
    turns: null,
    createdAt: null,
    updatedAt: null,
    tone: null,
    model: null,
    effort: null,
    fastMode: null,
    sessionId: null,
    workspace: null,
    origins: null,
    handoff: {
      record: {
        fromChatId: null,
        fromHarness: null,
        createdAt: null,
        summary: null,
        delivered: null,
      },
    },
    newDomain: { record: { id: null, origin: null, path: null } },
    queue: {
      list: {
        record: {
          id: null,
          text: null,
          comments: null,
          attachments: {
            list: { record: { id: null, name: null, mimeType: null, size: null } },
            by: 'id',
          },
          createdAt: null,
        },
      },
      by: 'id',
    },
  },
}

/** One chat's file; a chat not there reads as none. */
const chatState = (id: string): StateFile<StoredChat | null> => ({
  name: chatFile(id),
  decode: decodeChat(id),
  shape: CHAT_SHAPE,
  empty: () => null,
})

/** The tab a workspace opens on, by id; none until one is. */
const ACTIVE_STATE: StateFile<{ activeId: string }> = {
  name: ACTIVE_FILE,
  decode: (value) => {
    const record = asJsonRecord(value)
    if (!record) return refused('it does not point at a tab')
    if (absent(record.activeId)) return { value: { activeId: '' } }
    const activeId = asString(record.activeId)
    return activeId === undefined ? refused('activeId is not a chat id') : { value: { activeId } }
  },
  shape: { record: { activeId: null } },
  empty: () => ({ activeId: '' }),
}

/** The order the tabs were arranged in, by id. */
const ORDER_STATE: StateFile<{ order: string[] }> = {
  name: ORDER_FILE,
  decode: (value) => {
    const record = asJsonRecord(value)
    if (!record) return refused('it is not an order of tabs')
    if (absent(record.order)) return { value: { order: [] } }
    const order = asStringArray(record.order)
    return order ? { value: { order: [...order] } } : refused('order is not a list of chat ids')
  },
  shape: { record: { order: null } },
  empty: () => ({ order: [] }),
}

/** What the tabs read of a file of theirs: one not read whole reads as none, and is named apart. */
function readOrNone<T>(root: string, file: StateFile<T>): T {
  const read = readStateFile(root, file)
  return read.status === 'ok' ? read.value : file.empty()
}

function newChat(harness: string, extra?: Partial<StoredChat>): StoredChat {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    title: DEFAULT_CHAT_TITLE,
    harness,
    turns: 0,
    createdAt: now,
    updatedAt: now,
    ...extra,
  }
}

/** The chat, none when no file holds it; `UnreadableState` when its file is not read whole. */
function readChat(root: string, chatId: string): StoredChat | undefined {
  if (!CHAT_ID.test(chatId)) return undefined
  const read = readStateFile(root, chatState(chatId))
  if (read.status === 'unreadable') throw new UnreadableState(read.path, read.reason)
  return read.status === 'ok' ? (read.value ?? undefined) : undefined
}

/** A new chat's file: its id is new, so no file is there to keep anything of. */
function writeChat(root: string, chat: StoredChat): void {
  writeJson(root, chatFile(chat.id), chat)
}

function readActiveId(activeRoot: string): string {
  return readOrNone(activeRoot, ACTIVE_STATE).activeId
}

/** Points the workspace at a tab; `UnreadableState` when its pointer is not read whole. */
function writeActiveId(activeRoot: string, activeId: string): void {
  changeStateFile(activeRoot, ACTIVE_STATE, (current) =>
    current.activeId === activeId ? undefined : { ...current, activeId },
  )
}

function readOrder(root: string): string[] {
  return readOrNone(root, ORDER_STATE).order
}

/**
 * Every file of the tabs this Studio cannot read whole, with why: each chat file left out of the
 * tabs, the workspace's active pointer and the tabs' order read as none. Each is left as it is.
 */
export function unreadableChatFiles(
  root: string,
  activeRoot = root,
): { path: string; reason: string; chatId?: string }[] {
  const found: { path: string; reason: string; chatId?: string }[] = []
  for (const file of listState(root, CHATS_DIR)) {
    const id = file.endsWith('.json') ? file.slice(0, -'.json'.length) : ''
    if (!CHAT_ID.test(id)) continue
    const read = readStateFile(root, chatState(id))
    if (read.status === 'unreadable')
      found.push({ path: read.path, reason: read.reason, chatId: id })
  }
  for (const [at, file] of [
    [activeRoot, ACTIVE_STATE],
    [root, ORDER_STATE],
  ] as const) {
    const read = readStateFile<unknown>(at, file)
    if (read.status === 'unreadable') found.push({ path: read.path, reason: read.reason })
  }
  return found
}

/**
 * Every tab on disk read whole, in the order the user arranged them; a file not
 * read whole is left out, and left as it is.
 *
 * The arrangement is a list of ids beside the chats, not a field on each: one
 * drag rewrites one file, and a tab another window opens meanwhile is simply
 * absent from it and lands last, where a new tab always does.
 */
function readChats(root: string): StoredChat[] {
  const chats = readChatsByAge(root)
  const order = readOrder(root)
  if (order.length === 0) return chats
  const rank = new Map(order.map((id, index) => [id, index]))
  // a stable sort: tabs the arrangement never saw keep their age order, after it
  return chats.sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length))
}

/** Every tab on disk read whole, oldest first: one that is not must not hide the rest. */
function readChatsByAge(root: string): StoredChat[] {
  const chats: StoredChat[] = []
  for (const file of listState(root, CHATS_DIR)) {
    const id = file.endsWith('.json') ? file.slice(0, -'.json'.length) : ''
    if (!CHAT_ID.test(id)) continue
    const read = readStateFile(root, chatState(id))
    if (read.status === 'ok' && read.value) chats.push(read.value)
  }
  return chats.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

function readStore(root: string, activeRoot = root): ChatStore {
  return { activeId: readActiveId(activeRoot), chats: readChats(root) }
}

/** The tab in front of the user, read as it is: nothing is created or repaired. */
export function peekActiveChat(root: string, activeRoot = root): StoredChat | undefined {
  const store = readStore(root, activeRoot)
  return store.chats.find((chat) => chat.id === store.activeId) ?? store.chats.at(-1)
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
    const chat = newChat(defaultHarness, {
      ...seedFields(seed),
      tone: nextChatTone([], defaultHarness),
    })
    writeChat(root, chat)
    store.chats.push(chat)
  }
  if (!store.chats.some((chat) => chat.id === store.activeId)) {
    store.activeId = store.chats[store.chats.length - 1]!.id
    // a pointer not read whole is left as it is: the tabs open on the newest meanwhile
    if (readStateFile(activeRoot, ACTIVE_STATE).status !== 'unreadable')
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
  return resolveChat(root, defaultHarness, undefined, seed, activeRoot)!
}

/**
 * Resolve a caller-supplied chat id, falling back to the active tab; a chat whose file is not
 * read whole is refused (`UnreadableState`), not taken for one that is not there.
 */
export function resolveChat(
  root: string,
  defaultHarness: string,
  chatId?: string,
  seed?: ChatSeed,
  activeRoot = root,
): StoredChat | undefined {
  const store = ensureChats(root, defaultHarness, seed, activeRoot)
  const wanted = chatId || store.activeId
  return (
    store.chats.find((chat) => chat.id === wanted) ?? (chatId ? readChat(root, chatId) : undefined)
  )
}

export function createChat(
  root: string,
  input: {
    harness: string
    title?: string
    model?: string
    effort?: AgentEffort
    fastMode?: boolean
    handoff?: ChatHandoff
    newDomain?: NewDomainContext
  } & ChatSeed,
  activeRoot = root,
): StoredChat {
  const chat = newChat(input.harness, {
    ...seedFields(input),
    // by age, not by arrangement: "the newest tab's hue" means the last one OPENED
    tone: nextChatTone(readChatsByAge(root), input.harness),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.fastMode === undefined ? {} : { fastMode: input.fastMode }),
    ...(input.handoff
      ? {
          handoff: { ...input.handoff, summary: input.handoff.summary.slice(0, MAX_HANDOFF_CHARS) },
        }
      : {}),
    ...(input.newDomain ? { newDomain: { ...input.newDomain } } : {}),
  })
  // the pointer first: one not read whole refuses the new tab before any file is written
  stateOf(activeRoot, ACTIVE_STATE)
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
      title:
        source.title === DEFAULT_CHAT_TITLE ? DEFAULT_CHAT_TITLE : `${source.title} (${harness})`,
      ...(model ? { model } : {}),
      // how hard you asked this work to be thought about is about the work, not
      // about the agent — it follows, mapped onto whatever ladder it lands on
      ...(source.effort ? { effort: source.effort } : {}),
      ...(source.fastMode === undefined ? {} : { fastMode: source.fastMode }),
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

/**
 * Apply `patch` to one chat and stamp `updatedAt`; the harness is never patchable.
 * A patch that returns `false` changed nothing, and the file is left as it was; so is
 * a file not read whole (`UnreadableState`). Every key this Studio does not know is kept.
 */
function mutateChat(
  root: string,
  chatId: string,
  patch: (chat: StoredChat) => void | false,
): StoredChat | undefined {
  if (!CHAT_ID.test(chatId)) return undefined
  let changed: StoredChat | undefined
  changeStateFile(root, chatState(chatId), (chat) => {
    if (!chat || patch(chat) === false) return undefined
    chat.updatedAt = new Date().toISOString()
    changed = chat
    return chat
  })
  return changed
}

export function renameChat(root: string, chatId: string, title: string): StoredChat | undefined {
  const trimmed = title.trim().slice(0, 80)
  return mutateChat(root, chatId, (chat) => {
    chat.title = trimmed || DEFAULT_CHAT_TITLE
  })
}

/** Give a still-unnamed tab the shape of its first instruction. */
export function titleChatFromMessage(root: string, chatId: string, message: string): void {
  const summary = message.trim().split('\n')[0]?.trim()
  if (!summary) return
  mutateChat(root, chatId, (chat) => {
    if (chat.title === DEFAULT_CHAT_TITLE)
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

export function setChatFastMode(
  root: string,
  chatId: string,
  fastMode: boolean,
): StoredChat | undefined {
  return mutateChat(root, chatId, (chat) => {
    chat.fastMode = fastMode
  })
}

/** Resume `sessionId` next turn; the caller clears a blank one with `clearChatSession`. */
export function setChatSession(root: string, chatId: string, sessionId: string): void {
  mutateChat(root, chatId, (chat) => {
    chat.sessionId = sessionId
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
  comments?: string[],
  attachments?: ChatAttachment[],
): QueuedMessage | undefined {
  const message: QueuedMessage = {
    id: randomUUID(),
    text: text.trim(),
    ...(comments?.length ? { comments } : {}),
    ...(attachments?.length ? { attachments } : {}),
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
  mutateChat(root, chatId, (chat) => {
    const queue = chatQueue(chat)
    const found = messageId ? queue.find((entry) => entry.id === messageId) : queue[0]
    if (!found) return false
    chat.queue = queue.filter((entry) => entry.id !== found.id)
    taken = found
  })
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
  let edited: QueuedMessage | undefined
  mutateChat(root, chatId, (chat) => {
    chat.queue = chatQueue(chat).map((entry) => {
      // the text may go only when images are left to carry the message
      if (entry.id !== messageId || (!trimmed && !entry.attachments?.length)) return entry
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
  const moved = mutateChat(root, chatId, (chat) => {
    const queue = [...chatQueue(chat)]
    const from = queue.findIndex((entry) => entry.id === messageId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= queue.length) return false
    queue.splice(to, 0, queue.splice(from, 1)[0]!)
    chat.queue = queue
  })
  return moved !== undefined
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
  let answer: 'cleared' | 'delivered' | 'missing' = 'missing'
  mutateChat(root, chatId, (chat) => {
    if (!chat.handoff) return false
    if (chat.handoff.delivered) {
      answer = 'delivered'
      return false
    }
    delete chat.handoff
    answer = 'cleared'
  })
  return answer
}

/** The briefing still owed to this chat's harness, if any. */
export function pendingHandoff(chat: StoredChat): string | undefined {
  return chat.handoff && !chat.handoff.delivered ? chat.handoff.summary : undefined
}

/**
 * Whether a tab is still open — a closed one must stop accreting state. One whose file is not
 * read whole is open still: its file is there, and so is what it accretes.
 */
export function chatExists(root: string, chatId: string): boolean {
  return CHAT_ID.test(chatId) && stateExists(root, chatFile(chatId))
}

/** Bring a tab to the front; one whose file is not read whole is refused: `UnreadableState`. */
export function setActiveChat(root: string, chatId: string, activeRoot = root): boolean {
  if (!readChat(root, chatId)) return false
  writeActiveId(activeRoot, chatId)
  return true
}

/**
 * Arrange the tabs in `order`.
 *
 * Ids no tab holds are dropped, and tabs the caller did not name keep their
 * place relative to each other, after the named ones: a window that has not
 * seen a tab yet cannot lose it by dragging another.
 */
export function setChatOrder(root: string, order: string[]): StoredChat[] {
  const chats = readChats(root)
  const known = new Set(chats.map((chat) => chat.id))
  const named = [...new Set(order)].filter((id) => known.has(id))
  const rest = chats.map((chat) => chat.id).filter((id) => !named.includes(id))
  changeStateFile(root, ORDER_STATE, (current) => ({ ...current, order: [...named, ...rest] }))
  return readChats(root)
}

/**
 * Drop a tab. The last one may go too — the next read seeds a fresh one. One whose file is not
 * read whole is left as it is, and so is every tab while the order or the pointer is not:
 * `UnreadableState`.
 */
export function deleteChat(root: string, chatId: string, activeRoot = root): boolean {
  if (!readChat(root, chatId)) return false
  // the order and the pointer first: one not read whole refuses the close before anything goes
  stateOf(root, ORDER_STATE)
  stateOf(activeRoot, ACTIVE_STATE)
  removeState(root, chatFile(chatId))
  changeStateFile(root, ORDER_STATE, (current) =>
    current.order.includes(chatId)
      ? { ...current, order: current.order.filter((id) => id !== chatId) }
      : undefined,
  )
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
    ...(chat.tone === undefined ? {} : { tone: chat.tone }),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    status,
    queued: chatQueue(chat),
    ...(chat.workspace === undefined ? {} : { workspace: chat.workspace }),
    ...(chat.origins === undefined ? {} : { origins: [...chat.origins] }),
    ...(chat.model === undefined ? {} : { model: chat.model }),
    ...(chat.effort === undefined ? {} : { effort: chat.effort }),
    ...(chat.fastMode === undefined ? {} : { fastMode: chat.fastMode }),
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
