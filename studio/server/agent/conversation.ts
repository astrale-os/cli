import type { AgentSessionInfo, ConversationInfo } from '../../shared/types'

import { readJson, removeState, writeJson } from '../state/store'

const SESSION_FILE = '.cache/agent/session.json'

interface HarnessConversation {
  sessionId?: string
  turns?: number
  updatedAt?: string
}

interface ConversationStore {
  version: 1
  conversations: Record<string, HarnessConversation>
}

interface LegacySessionState extends HarnessConversation {
  harness?: string
}

function readStore(root: string): ConversationStore {
  const raw = readJson<ConversationStore | LegacySessionState | null>(root, SESSION_FILE, null)
  if (!raw) return { version: 1, conversations: {} }
  if ('conversations' in raw) {
    if (raw.version !== 1)
      throw new Error(`unsupported agent conversation store version: ${String(raw.version)}`)
    if (raw.conversations) return { version: 1, conversations: { ...raw.conversations } }
  }
  if ('harness' in raw && raw.harness && raw.sessionId) {
    return {
      version: 1,
      conversations: {
        [raw.harness]: {
          sessionId: raw.sessionId,
          turns: raw.turns ?? 0,
          updatedAt: raw.updatedAt,
        },
      },
    }
  }
  return { version: 1, conversations: {} }
}

function writeStore(root: string, store: ConversationStore): void {
  const entries = Object.entries(store.conversations).filter(([, c]) => !!c.sessionId)
  if (entries.length === 0) {
    removeState(root, SESSION_FILE)
    return
  }
  writeJson(root, SESSION_FILE, {
    version: 1,
    conversations: Object.fromEntries(entries),
  } satisfies ConversationStore)
}

export function readConversation(root: string, harness: string): HarnessConversation {
  return readStore(root).conversations[harness] ?? {}
}

export function conversationInfo(root: string, harness: string): ConversationInfo {
  const conversation = readConversation(root, harness)
  return {
    active: !!conversation.sessionId,
    turns: conversation.turns ?? 0,
    harness: conversation.sessionId ? harness : undefined,
  }
}

export function sessionInfo(root: string, harness: string): AgentSessionInfo {
  const conversation = readConversation(root, harness)
  return {
    sessionId: conversation.sessionId ?? null,
    turns: conversation.turns ?? 0,
    harness: conversation.sessionId ? harness : undefined,
  }
}

export function saveConversation(
  root: string,
  harness: string,
  conversation: Required<Pick<HarnessConversation, 'sessionId' | 'turns'>> &
    Pick<HarnessConversation, 'updatedAt'>,
): void {
  const store = readStore(root)
  store.conversations[harness] = conversation
  writeStore(root, store)
}

export function setConversationSession(root: string, harness: string, sessionId: string): void {
  const trimmed = sessionId.trim()
  if (!trimmed) {
    clearConversation(root, harness)
    return
  }
  const store = readStore(root)
  const previous = store.conversations[harness] ?? {}
  store.conversations[harness] = {
    sessionId: trimmed,
    turns: previous.turns ?? 0,
    updatedAt: new Date().toISOString(),
  }
  writeStore(root, store)
}

export function clearConversation(root: string, harness: string): void {
  const store = readStore(root)
  delete store.conversations[harness]
  writeStore(root, store)
}
