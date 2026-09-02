import type {
  AgentRunSnapshot,
  AgentRunStatus,
  AgentSessionInfo,
  AgentSubmitResult,
  ChatInfo,
  ChatList,
  ChatStatus,
  ConversationInfo,
  StudioEvent,
} from '../../../shared/types'
import type { StoredChat } from '../chats'
import type { AgentWorkspace } from '../workspace'

import {
  activeChat,
  chatInfo,
  chatQueue,
  clearChatHandoff,
  clearChatSession,
  createChat,
  deleteChat,
  editQueuedMessage,
  enqueueChatMessage,
  ensureChats,
  forkChat,
  markHandoffDelivered,
  MAX_QUEUED_MESSAGES,
  moveQueuedMessage,
  pendingHandoff,
  renameChat,
  requeueChatMessage,
  resolveChat,
  setActiveChat,
  setChatEffort,
  setChatModel,
  setChatSession,
  takeQueuedMessage,
  titleChatFromMessage,
  type ChatSeed,
} from '../chats'
import { inspectHarnessHealth } from '../harness/adapter'
import { getHarnessById, hasHarness } from '../harness/registry'
import { getHarness, getHarnessSelection } from '../harness/selection'
import { emitStudioEvent } from '../notify'
import { summarizeChatTranscript } from '../transfer'
import { agentWorkspace, domainOrigin } from '../workspace'
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
  waitUntilIdle,
} from './live-state'
import { prepareRun, type PreparedRun, type SubmitOpts } from './preparation'
import { deleteChatRuns, persistRun, readChatTranscript, readRunHistory } from './transcript'

export type ChatResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The agent everything falls back on — the starred model's; see harness/selection. */
function defaultHarness(): string {
  return getHarness().id
}

/** What a chat opened now records about where it was opened. */
function seedOf(workspace: AgentWorkspace): ChatSeed {
  return { workspace: workspace.root, origins: workspace.domains.map(domainOrigin) }
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
function newChatHarness(workspace: AgentWorkspace): string {
  const selection = getHarnessSelection()
  if (selection.source !== 'default') return selection.id
  return (
    resolveChat(workspace.stateRoot, selection.id, undefined, seedOf(workspace), workspace.uiRoot)
      ?.harness ?? selection.id
  )
}

/** A chat's status is its own live run's — tabs never report each other's work. */
function statusOf(stateRoot: string, chat: StoredChat): ChatStatus {
  hydrateRun(stateRoot, chat)
  return currentRun(chat.id)?.status ?? 'idle'
}

function describe(workspace: AgentWorkspace, chat: StoredChat): ChatInfo {
  return chatInfo(chat, statusOf(workspace.stateRoot, chat))
}

function chatOf(workspace: AgentWorkspace, chatId?: string): StoredChat | undefined {
  return resolveChat(
    workspace.stateRoot,
    defaultHarness(),
    chatId,
    seedOf(workspace),
    workspace.uiRoot,
  )
}

/** The harness a chat is bound to — what a route must honour instead of the default. */
export function chatHarness(chatId?: string): string | undefined {
  return chatOf(agentWorkspace(), chatId)?.harness
}

/** The model this chat overrides its harness with, if any. */
export function chatModel(chatId?: string): string | undefined {
  return chatOf(agentWorkspace(), chatId)?.model
}

/** Every open tab of the workspace, plus the one it opens on. */
export function listChats(): ChatList {
  const workspace = agentWorkspace()
  const store = ensureChats(
    workspace.stateRoot,
    defaultHarness(),
    seedOf(workspace),
    workspace.uiRoot,
  )
  return {
    chats: store.chats.map((chat) => describe(workspace, chat)),
    activeId: store.activeId,
  }
}

function withChat<T>(
  chatId: string | undefined,
  run: (workspace: AgentWorkspace, chat: StoredChat) => T,
): ChatResult<T> {
  const workspace = agentWorkspace()
  const chat = chatOf(workspace, chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  return { ok: true, value: run(workspace, chat) }
}

export function openChat(input: { harness?: string; title?: string }): ChatResult<ChatInfo> {
  const workspace = agentWorkspace()
  const harness = input.harness?.trim().toLowerCase() || newChatHarness(workspace)
  if (!hasHarness(harness)) return { ok: false, error: `unknown harness: ${harness}` }
  const chat = createChat(
    workspace.stateRoot,
    {
      harness,
      ...seedOf(workspace),
      ...(input.title === undefined ? {} : { title: input.title }),
    },
    workspace.uiRoot,
  )
  return { ok: true, value: describe(workspace, chat) }
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
  chatId: string | undefined,
  harness: string,
  model?: string,
): ChatResult<ChatInfo> {
  const target = harness.trim().toLowerCase()
  if (!hasHarness(target)) return { ok: false, error: `unknown harness: ${harness}` }
  const workspace = agentWorkspace()
  const source = chatOf(workspace, chatId)
  if (!source) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  if (source.harness === target) return { ok: false, error: `this chat already runs ${target}` }

  const live = currentRun(source.id)
  const stored = readChatTranscript(workspace.stateRoot, source)
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
    value: describe(
      workspace,
      forkChat(workspace.stateRoot, source, target, summary, model, workspace.uiRoot),
    ),
  }
}

export function selectChat(chatId: string): ChatResult<ChatList> {
  const workspace = agentWorkspace()
  if (!setActiveChat(workspace.stateRoot, chatId, workspace.uiRoot))
    return { ok: false, error: `unknown chat: ${chatId}` }
  return { ok: true, value: listChats() }
}

export function updateChat(
  chatId: string,
  patch: { title?: string; model?: string; effort?: string },
): ChatResult<ChatInfo> {
  return withChat(chatId, (workspace, chat) => {
    // The harness is deliberately absent from this patch: see switchChatHarness.
    if (patch.title !== undefined) renameChat(workspace.stateRoot, chat.id, patch.title)
    if (patch.model !== undefined) setChatModel(workspace.stateRoot, chat.id, patch.model)
    if (patch.effort !== undefined) setChatEffort(workspace.stateRoot, chat.id, patch.effort)
    return describe(workspace, chatOf(workspace, chat.id) ?? chat)
  })
}

/**
 * Forget where this chat came from before its briefing is sent.
 *
 * Only this chat changes — the conversation it was forked from keeps its own
 * tab and its own transcript. Once sent, the briefing is immutable conversation
 * history: hiding it would imply that the agent could somehow unread it.
 */
export function forgetChatOrigin(chatId: string): ChatResult<ChatInfo> {
  const workspace = agentWorkspace()
  const chat = chatOf(workspace, chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId}` }
  const cleared = clearChatHandoff(workspace.stateRoot, chat.id)
  if (cleared === 'delivered')
    return { ok: false, error: 'the transferred context was already sent to the agent' }
  if (cleared === 'missing')
    return { ok: false, error: 'this chat has no unsent transferred context' }
  return { ok: true, value: describe(workspace, chatOf(workspace, chat.id) ?? chat) }
}

/** Close a tab: its turn is stopped, its transcripts and its row are removed. */
export function closeChat(chatId: string): ChatResult<ChatList> {
  const workspace = agentWorkspace()
  const chat = chatOf(workspace, chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId}` }
  cancelActiveRun(chat.id)
  // Drop the row FIRST: a turn settling a moment later then finds no chat to
  // persist against, instead of racing the transcript cleanup below.
  deleteChat(workspace.stateRoot, chat.id, workspace.uiRoot)
  deleteChatRuns(workspace.stateRoot, chat)
  forgetChat(chat.id)
  return { ok: true, value: listChats() }
}

export async function getSnapshot(chatId?: string): Promise<AgentRunSnapshot> {
  const workspace = agentWorkspace()
  // A client can hold the id of a tab another window just closed; showing the
  // active conversation beats erroring out of a plain read.
  const chat =
    chatOf(workspace, chatId) ??
    activeChat(workspace.stateRoot, defaultHarness(), seedOf(workspace), workspace.uiRoot)
  // The tab's own agent, not the default: a Codex chat is unavailable when Codex
  // is missing, whatever a NEW conversation would open with.
  const harness = getHarnessById(chat.harness)
  hydrateRun(workspace.stateRoot, chat)
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

export function getHistory(chatId?: string, limit?: number) {
  return withChat(chatId, (workspace, chat) => readRunHistory(workspace.stateRoot, chat, limit))
}

export function cancelRun(chatId?: string): boolean {
  const resolved = withChat(chatId, (_workspace, chat) => cancelActiveRun(chat.id))
  return resolved.ok && resolved.value
}

export function getSessionId(chatId?: string): AgentSessionInfo {
  const resolved = withChat(chatId, (_workspace, chat): AgentSessionInfo => ({
    sessionId: chat.sessionId ?? null,
    turns: chat.turns,
    ...(chat.sessionId ? { harness: chat.harness } : {}),
  }))
  return resolved.ok ? resolved.value : { sessionId: null, turns: 0 }
}

export function setSessionId(
  chatId: string | undefined,
  sessionId: string,
): ChatResult<AgentSessionInfo> {
  const workspace = agentWorkspace()
  const chat = chatOf(workspace, chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  if (isRunActive(chat.id))
    return { ok: false, error: 'the session id cannot be changed while a turn is running' }
  const trimmed = sessionId.trim()
  if (trimmed) setChatSession(workspace.stateRoot, chat.id, trimmed)
  else clearChatSession(workspace.stateRoot, chat.id)
  return { ok: true, value: getSessionId(chat.id) }
}

/**
 * Start a turn in one chat — or park the message behind the one already running.
 *
 * Typing while the agent works is not an error to report back: it is the queue,
 * and the turn that settles sends the next message itself (`drainQueue`). Only a
 * caller that has already taken responsibility for ordering passes `queue:
 * false` — the drain and the promote below, which must be told they lost the
 * chat rather than silently re-queued at the wrong end.
 */
export async function submitRun(
  notify: (event: StudioEvent) => void,
  options?: SubmitOpts & { chatId?: string; queue?: boolean },
): Promise<AgentSubmitResult> {
  const workspace = agentWorkspace()
  const chat = chatOf(workspace, options?.chatId)
  if (!chat) return { error: `unknown chat: ${options?.chatId ?? '(active)'}` }
  const controller = reserveRun(chat.id)
  if (!controller) {
    // Reserving and parking are ONE synchronous decision: nothing can settle the
    // running turn between them, so a message never lands in a queue that was
    // drained a moment ago and will never be drained again.
    const message = options?.message?.trim()
    if (!message || options?.queue === false)
      return { error: 'a turn is already running in this chat' }
    if (chatQueue(chat).length >= MAX_QUEUED_MESSAGES)
      return { error: `the queue is full — ${MAX_QUEUED_MESSAGES} messages already wait here` }
    const queued = enqueueChatMessage(workspace.stateRoot, chat.id, message)
    if (!queued) return { error: `unknown chat: ${chat.id}` }
    emitStudioEvent(notify, { type: 'chats' })
    return { queued }
  }
  try {
    const result = await prepareRun(workspace, chat, notify, controller, options)
    if ('error' in result) return result
    const { prepared } = result
    // Pressing Send commits the frozen first-turn prompt. From this point the
    // briefing is conversation history, even while the harness is still working,
    // so the UI must not offer to delete something the agent may already read.
    if (pendingHandoff(chat) && prepared.run.prompt?.firstTurn)
      markHandoffDelivered(workspace.stateRoot, chat.id)
    if (options?.message) titleChatFromMessage(workspace.stateRoot, chat.id, options.message)
    attachCancellation(chat.id, controller, prepared.bridge.dispose)
    setCurrentRun(prepared.run)
    persistRun(workspace.stateRoot, prepared.run)
    emitStudioEvent(notify, { type: 'agent-run', chatId: chat.id, run: prepared.run })
    void runThenDrain(prepared, controller, notify)
    return { run: prepared.run }
  } finally {
    releasePreparation(chat.id, controller)
  }
}

/** Run one turn to its end, then let the queue move. */
async function runThenDrain(
  prepared: PreparedRun,
  controller: AbortController,
  notify: (event: StudioEvent) => void,
): Promise<void> {
  try {
    await completeRun(prepared, controller, notify)
  } catch {
    /* completeRun records its own failure on the run it settles */
  }
  await drainQueue(prepared.chat.id, notify, prepared.run.status)
}

/**
 * Send the next queued message, now that the chat is free.
 *
 * A turn that RAN hands over to the next message, whether it ended well or
 * badly — a failed turn is still a turn the user watched go by. A CANCELED one
 * does not: stopping is how you take the wheel back, and the queue waits for
 * you. Nor does an INTERRUPTED one, which means the Studio process died
 * mid-turn: restarting must not replay work nobody is watching.
 */
async function drainQueue(
  chatId: string,
  notify: (event: StudioEvent) => void,
  settled: AgentRunStatus,
): Promise<void> {
  if (settled !== 'succeeded' && settled !== 'failed') return
  const stateRoot = agentWorkspace().stateRoot
  const next = takeQueuedMessage(stateRoot, chatId)
  if (!next) return
  emitStudioEvent(notify, { type: 'chats' })
  let result: AgentSubmitResult
  try {
    result = await submitRun(notify, { message: next.text, chatId, queue: false })
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) }
  }
  if (!result.error) return
  // Nothing started, so the message goes back at the head it left. Another
  // window may simply have claimed the chat first — that turn's own drain picks
  // it up, and the queue keeps its order either way.
  requeueChatMessage(stateRoot, chatId, next)
  emitStudioEvent(notify, { type: 'chats' })
}

/** Resolve a chat, change its queue, and answer with the tab as it now stands. */
function withQueue(
  chatId: string | undefined,
  change: (stateRoot: string, chat: StoredChat) => string | undefined,
): ChatResult<ChatInfo> {
  const workspace = agentWorkspace()
  const chat = chatOf(workspace, chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  const error = change(workspace.stateRoot, chat)
  if (error) return { ok: false, error }
  const updated = chatOf(workspace, chat.id) ?? chat
  return { ok: true, value: describe(workspace, updated) }
}

/** Rewrite a message that has not been sent yet. */
export function editQueued(
  chatId: string | undefined,
  messageId: string,
  text: string,
): ChatResult<ChatInfo> {
  return withQueue(chatId, (stateRoot, chat) => {
    if (!text.trim()) return 'a queued message cannot be empty — delete it instead'
    return editQueuedMessage(stateRoot, chat.id, messageId, text)
      ? undefined
      : `unknown queued message: ${messageId}`
  })
}

/** Drop a message before it is ever sent. */
export function dropQueued(chatId: string | undefined, messageId: string): ChatResult<ChatInfo> {
  return withQueue(chatId, (stateRoot, chat) =>
    takeQueuedMessage(stateRoot, chat.id, messageId)
      ? undefined
      : `unknown queued message: ${messageId}`,
  )
}

/** Move a queued message one place towards the front ('up') or the back. */
export function moveQueued(
  chatId: string | undefined,
  messageId: string,
  direction: 'up' | 'down',
): ChatResult<ChatInfo> {
  return withQueue(chatId, (stateRoot, chat) =>
    moveQueuedMessage(stateRoot, chat.id, messageId, direction === 'up' ? -1 : 1)
      ? undefined
      : `${messageId} cannot move ${direction}`,
  )
}

/**
 * Jump one queued message to the front of the line, stopping the turn in
 * progress for it.
 *
 * That interruption is the whole point — "send this now" answers a turn going
 * the wrong way — so the running turn is CANCELLED rather than left to finish.
 * Its own drain then holds the rest of the queue (a cancel means take the
 * wheel), which is what keeps this from sending two messages at once.
 */
export async function sendQueuedNow(
  notify: (event: StudioEvent) => void,
  chatId: string | undefined,
  messageId: string,
): Promise<ChatResult<AgentSubmitResult>> {
  const workspace = agentWorkspace()
  const chat = chatOf(workspace, chatId)
  if (!chat) return { ok: false, error: `unknown chat: ${chatId ?? '(active)'}` }
  const message = takeQueuedMessage(workspace.stateRoot, chat.id, messageId)
  if (!message) return { ok: false, error: `unknown queued message: ${messageId}` }
  emitStudioEvent(notify, { type: 'chats' })

  const restore = (error: string): ChatResult<AgentSubmitResult> => {
    requeueChatMessage(workspace.stateRoot, chat.id, message)
    emitStudioEvent(notify, { type: 'chats' })
    return { ok: false, error }
  }
  cancelActiveRun(chat.id)
  if (!(await waitUntilIdle(chat.id)))
    return restore('the running turn did not stop — try again in a moment')
  const result = await submitRun(notify, { message: message.text, chatId: chat.id, queue: false })
  return result.error ? restore(result.error) : { ok: true, value: result }
}
