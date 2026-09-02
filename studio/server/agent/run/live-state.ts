/**
 * live-state.ts — the in-memory run of each open chat.
 *
 * Keyed by CHAT: tabs are independent, so a turn running in one says nothing about
 * whether another may start. Chat ids are uuids, so one map safely spans every
 * workspace this process could serve.
 */
import type { AgentRun } from '../../../shared/types'
import type { StoredChat } from '../chats'

import { readLastRun } from './transcript'

const runs = new Map<string, AgentRun>()
const controllers = new Map<string, AbortController>()
const cancellation = new Map<string, () => void>()
const starting = new Set<string>()
const hydrated = new Set<string>()

export function currentRun(chatId: string): AgentRun | undefined {
  return runs.get(chatId)
}

export function setCurrentRun(run: AgentRun): void {
  runs.set(run.chatId, run)
}

export function isRunActive(chatId: string): boolean {
  const status = runs.get(chatId)?.status
  return starting.has(chatId) || status === 'running' || status === 'queued'
}

/** Reserve a chat synchronously before asynchronous run preparation begins. */
export function reserveRun(chatId: string): AbortController | null {
  if (isRunActive(chatId)) return null
  const controller = new AbortController()
  starting.add(chatId)
  controllers.set(chatId, controller)
  return controller
}

export function releasePreparation(chatId: string, controller: AbortController): void {
  starting.delete(chatId)
  if (controllers.get(chatId) === controller && !isRunActive(chatId)) {
    controllers.delete(chatId)
    cancellation.delete(chatId)
  }
}

export function attachCancellation(
  chatId: string,
  controller: AbortController,
  cancel: () => void,
): void {
  if (controllers.get(chatId) === controller) cancellation.set(chatId, cancel)
}

export function releaseController(chatId: string, controller: AbortController): void {
  if (controllers.get(chatId) === controller) {
    controllers.delete(chatId)
    cancellation.delete(chatId)
  }
}

export function cancelActiveRun(chatId: string): boolean {
  const controller = controllers.get(chatId)
  if (!controller) return false
  controller.abort()
  try {
    cancellation.get(chatId)?.()
  } catch {
    /* cancellation must still succeed */
  }
  return true
}

/**
 * Wait until a chat has no turn in flight.
 *
 * `cancelActiveRun` only ABORTS: the harness child still has to unwind, and the
 * reservation only lifts once the run settles. Promoting a queued message has to
 * wait for that, or its submit would bounce off the reservation it just stopped.
 * Polling rather than a promise per chat — a turn can also end without ever
 * reaching completion (cancelled during setup), and idleness is the one signal
 * both paths share.
 */
export async function waitUntilIdle(chatId: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (isRunActive(chatId)) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return true
}

/** Load a chat's last run from the machine-wide agent store, once per process. */
export function hydrateRun(root: string, chat: StoredChat): void {
  if (hydrated.has(chat.id) || runs.has(chat.id)) return
  hydrated.add(chat.id)
  const last = readLastRun(root, chat)
  if (last) runs.set(chat.id, last)
}

/** Forget a closed tab's live run so its id cannot resurrect from memory. */
export function forgetChat(chatId: string): void {
  runs.delete(chatId)
  controllers.delete(chatId)
  cancellation.delete(chatId)
  starting.delete(chatId)
  hydrated.delete(chatId)
}
