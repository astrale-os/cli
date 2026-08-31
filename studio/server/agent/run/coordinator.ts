import type {
  AgentRun,
  AgentRunSnapshot,
  ConversationInfo,
  StudioEvent,
} from '../../../shared/types'
import type { DomainHandle } from '../../domain'

import { getDomain } from '../../domain'
import {
  clearConversation,
  conversationInfo,
  sessionInfo,
  setConversationSession,
} from '../conversation'
import { getHarness } from '../harness/selection'
import { emitStudioEvent } from '../notify'
import { completeRun } from './completion'
import {
  attachCancellation,
  cancelActiveRun,
  currentRun,
  hydrateRun,
  isRunActive,
  releasePreparation,
  reserveRun,
  setCurrentRun,
} from './live-state'
import { prepareRun, type SubmitOpts } from './preparation'
import { persistRun } from './transcript'

function conversationOf(root: string): ConversationInfo {
  const harness = getHarness(root)
  return conversationInfo(root, harness.id)
}

export function isRunning(domainId: string): boolean {
  return isRunActive(domainId)
}

export async function getSnapshot(domainId: string): Promise<AgentRunSnapshot> {
  const handle = getDomain(domainId)
  const harness = getHarness(handle?.root ?? process.cwd())
  if (handle) hydrateRun(domainId, handle.root)
  return {
    harness: harness.id,
    available: await harness.isAvailable(),
    run: currentRun(domainId) ?? null,
    conversation: handle ? conversationOf(handle.root) : { active: false, turns: 0 },
  }
}

export function cancelRun(domainId: string): boolean {
  return cancelActiveRun(domainId)
}

export function getSessionId(domainId: string): {
  sessionId: string | null
  turns: number
  harness?: string
} {
  const handle = getDomain(domainId)
  if (!handle) return { sessionId: null, turns: 0 }
  return sessionInfo(handle.root, getHarness(handle.root).id)
}

export function setSessionId(domainId: string, sessionId: string): boolean {
  const handle = getDomain(domainId)
  if (!handle || isRunActive(domainId)) return false
  const harness = getHarness(handle.root)
  const trimmed = sessionId.trim()
  if (!trimmed) clearConversation(handle.root, harness.id)
  else setConversationSession(handle.root, harness.id, trimmed)
  return true
}

export async function submitRun(
  handle: DomainHandle,
  notify: (event: StudioEvent) => void,
  options?: SubmitOpts,
): Promise<{ run?: AgentRun; error?: string }> {
  const controller = reserveRun(handle.id)
  if (!controller) return { error: 'an agent run is already in progress for this domain' }
  try {
    const result = await prepareRun(handle, notify, controller, options)
    if ('error' in result) return result
    const { prepared } = result
    attachCancellation(handle.id, controller, prepared.bridge.dispose)
    setCurrentRun(prepared.run)
    persistRun(prepared.root, prepared.run)
    emitStudioEvent(notify, { type: 'agent-run', domainId: handle.id, run: prepared.run })
    void completeRun(prepared, controller, notify)
    return { run: prepared.run }
  } finally {
    releasePreparation(handle.id, controller)
  }
}
