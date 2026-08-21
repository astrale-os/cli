import type { AgentSessionInfo, ConversationInfo } from '../../shared/types'

import { asFiniteNumber, asJsonRecord, asString } from '../json'
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

type DecodedConversationWire =
  | {
      kind: 'versioned'
      version: number | undefined
      conversations: Record<string, HarnessConversation>
    }
  | { kind: 'legacy'; state: LegacySessionState }

function decodeHarnessConversation(value: unknown): HarnessConversation | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const sessionId = asString(record.sessionId)
  const turnsValue = asFiniteNumber(record.turns)
  const turns =
    turnsValue !== undefined && turnsValue >= 0 && Number.isInteger(turnsValue)
      ? turnsValue
      : undefined
  const updatedAt = asString(record.updatedAt)
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(turns === undefined ? {} : { turns }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function decodeConversationWire(value: unknown): DecodedConversationWire | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  if ('conversations' in record) {
    const conversations: Record<string, HarnessConversation> = {}
    for (const [harness, candidate] of Object.entries(asJsonRecord(record.conversations) ?? {})) {
      const conversation = decodeHarnessConversation(candidate)
      if (conversation) conversations[harness] = conversation
    }
    return {
      kind: 'versioned',
      version: asFiniteNumber(record.version),
      conversations,
    }
  }
  const state = decodeHarnessConversation(record)
  if (!state) return undefined
  const harness = asString(record.harness)
  return { kind: 'legacy', state: { ...state, ...(harness === undefined ? {} : { harness }) } }
}

function readStore(root: string): ConversationStore {
  const raw = readJson(root, SESSION_FILE, decodeConversationWire, null)
  if (!raw) return { version: 1, conversations: {} }
  if (raw.kind === 'versioned') {
    if (raw.version !== 1)
      throw new Error(`unsupported agent conversation store version: ${String(raw.version)}`)
    return { version: 1, conversations: { ...raw.conversations } }
  }
  const legacy = raw.state
  if (legacy.harness && legacy.sessionId) {
    return {
      version: 1,
      conversations: {
        [legacy.harness]: {
          sessionId: legacy.sessionId,
          turns: legacy.turns ?? 0,
          updatedAt: legacy.updatedAt,
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
