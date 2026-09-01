import type {
  AgentRunSnapshot,
  AgentSessionInfo,
  ChatInfo,
  ChatList,
  ChatStatus,
  ConversationInfo,
  StudioEvent,
} from '../../../shared/types'
import type { DomainHandle } from '../../domain'
import type { StoredChat } from '../chats'

import { getDomain } from '../../domain'
import {
  activeChat,
  chatInfo,
  clearChatHandoff,
  clearChatSession,
  createChat,
  deleteChat,
  ensureChats,
  forkChat,
  markHandoffDelivered,
  pendingHandoff,
  renameChat,
  resolveChat,
  setActiveChat,
  setChatEffort,
  setChatModel,
  setChatSession,
  titleChatFromMessage,
} from '../chats'
import { inspectHarnessHealth } from '../harness/adapter'
import { getHarnessById, hasHarness } from '../harness/registry'
import { getHarness, getHarnessSelection } from '../harness/selection'
import { emitStudioEvent } from '../notify'
import { summarizeChatTranscript } from '../transfer'
import { completeRun } from './completion'
import {
  attachCancellation,
  cancelActiveRun,
  currentRun,
  forgetChat,
  hydrateRun,
  isRunActive,
  releasePreparation,
  reserveRun,
  setCurrentRun,
} from './live-state'
import { prepareRun, type SubmitOpts } from './preparation'
import { deleteChatRuns, persistRun, readChatTranscript, readRunHistory } from './transcript'

export type ChatResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The agent a domain falls back on — the starred model's; see harness/selection. */
function defaultHarness(root: string): string {
  return getHarness(root).id
}

/**
 * The agent a new tab opens on — a question the GUI never asks.
 *
 * A starred model, or a `--harness` lock, names the agent outright: both are
 * deliberate statements about where conversations start, and the star's whole
 * promise is that new chats open on it. With neither, the tab continues with the
 * agent you are already working with, which is the only other honest answer.
 *
 * Either way, changing agent stays what it always was: pick a model of the
 * other one, in the conversation you want to move.
 */
function newChatHarness(root: string): string {
  const selection = getHarnessSelection(root)
  if (selection.source !== 'default') return selection.id
  return resolveChat(root, selection.id)?.harness ?? selection.id
}

/** A chat's status is its own live run's — tabs never report each other's work. */
function statusOf(domainId: string, root: string, chat: StoredChat): ChatStatus {
  hydrateRun(domainId, root, chat)
  return currentRun(chat.id)?.status ?? 'idle'
}

function describe(handle: DomainHandle, chat: StoredChat): ChatInfo {
  return chatInfo(chat, statusOf(handle.id, handle.root, chat))
}

/** The harness a chat is bound to — what a route must honour instead of the default. */
export function chatHarness(domainId: string, chatId?: string): string | undefined {
  const handle = getDomain(domainId)
  if (!handle) return undefined
  return resolveChat(handle.root, defaultHarness(handle.root), chatId)?.harness
}

/** The model this chat overrides its harness with, if any. */
export function chatModel(domainId: string, chatId?: string): string | undefined {
  const handle = getDomain(domainId)
  if (!handle) return undefined
  return resolveChat(handle.root, defaultHarness(handle.root), chatId)?.model
}

/** Every open tab of a domain, plus the one it opens on. */
export function listChats(domainId: string): ChatList {
  const handle = getDomain(domainId)
  if (!handle) return { chats: [], activeId: '' }
  const store = ensureChats(handle.root, defaultHarness(handle.root))
  return {
    chats: store.chats.map((chat) => describe(handle, chat)),
    activeId: store.activeId,
  }
}

function withChat<T>(
  domainId: string,
  chatId: string | undefined,
  run: (handle: DomainHandle, chat: StoredChat) => T,
): ChatResult<T> {
  const handle = getDomain(domainId)
  if (!handle) return { ok: false, error: `unknown domain: ${domainId}` }
  const chat = resolveChat(handle.root, defaultHarness(handle.root), chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  return { ok: true, value: run(handle, chat) }
}

export function openChat(
  domainId: string,
  input: { harness?: string; title?: string },
): ChatResult<ChatInfo> {
  const handle = getDomain(domainId)
  if (!handle) return { ok: false, error: `unknown domain: ${domainId}` }
  const harness = input.harness?.trim().toLowerCase() || newChatHarness(handle.root)
  if (!hasHarness(harness)) return { ok: false, error: `unknown harness: ${harness}` }
  const chat = createChat(handle.root, {
    harness,
    ...(input.title === undefined ? {} : { title: input.title }),
  })
  return { ok: true, value: describe(handle, chat) }
}

/**
 * Move to another harness the only way a conversation can: by forking.
 *
 * ALWAYS a new tab, never a jump to an existing one on that harness: the point
 * is to continue THIS work elsewhere, and an older tab of the target harness is
 * a different conversation. The source keeps its transcript, its session and its
 * place in the list — what crosses over is a summary, delivered on the new tab's
 * first turn.
 */
export function switchChatHarness(
  domainId: string,
  chatId: string | undefined,
  harness: string,
  model?: string,
): ChatResult<ChatInfo> {
  const target = harness.trim().toLowerCase()
  if (!hasHarness(target)) return { ok: false, error: `unknown harness: ${harness}` }
  const handle = getDomain(domainId)
  if (!handle) return { ok: false, error: `unknown domain: ${domainId}` }
  const source = resolveChat(handle.root, defaultHarness(handle.root), chatId)
  if (!source) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  if (source.harness === target) return { ok: false, error: `this chat already runs ${target}` }

  const live = currentRun(source.id)
  const stored = readChatTranscript(domainId, handle.root, source)
  // The live turn is fresher than its stored copy, and on a first turn it is the
  // only copy there is — a fork mid-conversation must still carry it.
  const runs = live ? [...stored.filter((run) => run.id !== live.id), live] : stored
  const summary = summarizeChatTranscript({
    runs,
    // the label, not the id: this text is read by a person in the chip as much
    // as by the agent receiving it
    fromHarness: getHarnessById(source.harness).label,
    title: source.title,
  })
  return {
    ok: true,
    value: describe(handle, forkChat(handle.root, source, target, summary, model)),
  }
}

export function selectChat(domainId: string, chatId: string): ChatResult<ChatList> {
  const handle = getDomain(domainId)
  if (!handle) return { ok: false, error: `unknown domain: ${domainId}` }
  if (!setActiveChat(handle.root, chatId)) return { ok: false, error: `unknown chat: ${chatId}` }
  return { ok: true, value: listChats(domainId) }
}

export function updateChat(
  domainId: string,
  chatId: string,
  patch: { title?: string; model?: string; effort?: string },
): ChatResult<ChatInfo> {
  return withChat(domainId, chatId, (handle, chat) => {
    // The harness is deliberately absent from this patch: see switchChatHarness.
    if (patch.title !== undefined) renameChat(handle.root, chat.id, patch.title)
    if (patch.model !== undefined) setChatModel(handle.root, chat.id, patch.model)
    if (patch.effort !== undefined) setChatEffort(handle.root, chat.id, patch.effort)
    return describe(handle, resolveChat(handle.root, defaultHarness(handle.root), chat.id) ?? chat)
  })
}

/**
 * Forget where this chat came from before its briefing is sent.
 *
 * Only this chat changes — the conversation it was forked from keeps its own
 * tab and its own transcript. Once sent, the briefing is immutable conversation
 * history: hiding it would imply that the agent could somehow unread it.
 */
export function forgetChatOrigin(domainId: string, chatId: string): ChatResult<ChatInfo> {
  const handle = getDomain(domainId)
  if (!handle) return { ok: false, error: `unknown domain: ${domainId}` }
  const chat = resolveChat(handle.root, defaultHarness(handle.root), chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId}` }
  const cleared = clearChatHandoff(handle.root, chat.id)
  if (cleared === 'delivered')
    return { ok: false, error: 'the transferred context was already sent to the agent' }
  if (cleared === 'missing')
    return { ok: false, error: 'this chat has no unsent transferred context' }
  return {
    ok: true,
    value: describe(handle, resolveChat(handle.root, defaultHarness(handle.root), chat.id) ?? chat),
  }
}

/** Close a tab: its turn is stopped, its transcripts and its row are removed. */
export function closeChat(domainId: string, chatId: string): ChatResult<ChatList> {
  const handle = getDomain(domainId)
  if (!handle) return { ok: false, error: `unknown domain: ${domainId}` }
  const chat = resolveChat(handle.root, defaultHarness(handle.root), chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId}` }
  cancelActiveRun(chat.id)
  // Drop the row FIRST: a turn settling a moment later then finds no chat to
  // persist against, instead of racing the transcript cleanup below.
  deleteChat(handle.root, chat.id)
  deleteChatRuns(domainId, handle.root, chat)
  forgetChat(chat.id)
  return { ok: true, value: listChats(domainId) }
}

export async function getSnapshot(domainId: string, chatId?: string): Promise<AgentRunSnapshot> {
  const handle = getDomain(domainId)
  if (!handle) {
    const harness = getHarness(process.cwd())
    return {
      chatId: '',
      harness: harness.id,
      available: (await inspectHarnessHealth(harness)).ok,
      run: null,
      conversation: { active: false, turns: 0 },
    }
  }
  // A client can hold the id of a tab another window just closed; showing the
  // active conversation beats erroring out of a plain read.
  const chat =
    resolveChat(handle.root, defaultHarness(handle.root), chatId) ??
    activeChat(handle.root, defaultHarness(handle.root))
  // The tab's own agent, not the domain's: a Codex chat is unavailable when Codex
  // is missing, whatever the domain would open a NEW conversation with.
  const harness = getHarnessById(chat.harness)
  hydrateRun(domainId, handle.root, chat)
  const conversation: ConversationInfo = {
    active: !!chat.sessionId,
    turns: chat.turns,
    ...(chat.sessionId ? { harness: chat.harness } : {}),
  }
  return {
    chatId: chat.id,
    harness: chat.harness,
    available: (await inspectHarnessHealth(harness)).ok,
    run: currentRun(chat.id) ?? null,
    conversation,
  }
}

export function getHistory(domainId: string, chatId?: string, limit?: number) {
  return withChat(domainId, chatId, (handle, chat) =>
    readRunHistory(domainId, handle.root, chat, limit),
  )
}

export function cancelRun(domainId: string, chatId?: string): boolean {
  const resolved = withChat(domainId, chatId, (_handle, chat) => cancelActiveRun(chat.id))
  return resolved.ok && resolved.value
}

export function getSessionId(domainId: string, chatId?: string): AgentSessionInfo {
  const resolved = withChat(domainId, chatId, (_handle, chat): AgentSessionInfo => ({
    sessionId: chat.sessionId ?? null,
    turns: chat.turns,
    ...(chat.sessionId ? { harness: chat.harness } : {}),
  }))
  return resolved.ok ? resolved.value : { sessionId: null, turns: 0 }
}

export function setSessionId(
  domainId: string,
  chatId: string | undefined,
  sessionId: string,
): ChatResult<AgentSessionInfo> {
  const handle = getDomain(domainId)
  if (!handle) return { ok: false, error: `unknown domain: ${domainId}` }
  const chat = resolveChat(handle.root, defaultHarness(handle.root), chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  if (isRunActive(chat.id))
    return { ok: false, error: 'the session id cannot be changed while a turn is running' }
  const trimmed = sessionId.trim()
  if (trimmed) setChatSession(handle.root, chat.id, trimmed)
  else clearChatSession(handle.root, chat.id)
  return { ok: true, value: getSessionId(domainId, chat.id) }
}

export async function submitRun(
  handle: DomainHandle,
  notify: (event: StudioEvent) => void,
  options?: SubmitOpts & { chatId?: string },
): Promise<{ run?: AgentRunSnapshot['run']; error?: string }> {
  const chat = resolveChat(handle.root, defaultHarness(handle.root), options?.chatId)
  if (!chat) return { error: `unknown chat: ${options?.chatId ?? '(active)'}` }
  const controller = reserveRun(chat.id)
  if (!controller) return { error: 'a turn is already running in this chat' }
  try {
    const result = await prepareRun(handle, chat, notify, controller, options)
    if ('error' in result) return result
    const { prepared } = result
    // Pressing Send commits the frozen first-turn prompt. From this point the
    // briefing is conversation history, even while the harness is still working,
    // so the UI must not offer to delete something the agent may already read.
    if (pendingHandoff(chat) && prepared.run.prompt?.firstTurn)
      markHandoffDelivered(handle.root, chat.id)
    if (options?.message) titleChatFromMessage(handle.root, chat.id, options.message)
    attachCancellation(chat.id, controller, prepared.bridge.dispose)
    setCurrentRun(prepared.run)
    persistRun(prepared.root, prepared.run)
    emitStudioEvent(notify, {
      type: 'agent-run',
      domainId: handle.id,
      chatId: chat.id,
      run: prepared.run,
    })
    void completeRun(prepared, controller, notify)
    return { run: prepared.run }
  } finally {
    releasePreparation(chat.id, controller)
  }
}
