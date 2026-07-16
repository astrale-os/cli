import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readJson, writeJson } from '../state/store'
import {
  clearConversation,
  readConversation,
  saveConversation,
  setConversationSession,
} from './conversation'

const roots: string[] = []
const root = () => {
  const value = mkdtempSync(join(tmpdir(), 'studio-conversation-'))
  roots.push(value)
  return value
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('per-harness conversations', () => {
  test('preserves independent Claude and Codex sessions', () => {
    const dir = root()
    saveConversation(dir, 'claude', {
      sessionId: 'claude-session',
      turns: 2,
      updatedAt: 'now',
    })
    saveConversation(dir, 'codex', {
      sessionId: 'codex-thread',
      turns: 3,
      updatedAt: 'later',
    })

    expect(readConversation(dir, 'claude')).toMatchObject({
      sessionId: 'claude-session',
      turns: 2,
    })
    expect(readConversation(dir, 'codex')).toMatchObject({
      sessionId: 'codex-thread',
      turns: 3,
    })
    clearConversation(dir, 'codex')
    expect(readConversation(dir, 'claude').sessionId).toBe('claude-session')
    expect(readConversation(dir, 'codex').sessionId).toBeUndefined()
  })

  test('migrates the legacy single-session shape on first write', () => {
    const dir = root()
    writeJson(dir, '.cache/agent/session.json', {
      harness: 'claude',
      sessionId: 'legacy-session',
      turns: 4,
      updatedAt: 'then',
    })
    expect(readConversation(dir, 'claude').turns).toBe(4)

    setConversationSession(dir, 'codex', 'codex-thread')
    const stored = readJson<any>(dir, '.cache/agent/session.json', {})
    expect(stored.version).toBe(1)
    expect(stored.conversations.claude.sessionId).toBe('legacy-session')
    expect(stored.conversations.codex.sessionId).toBe('codex-thread')
  })

  test('fails closed without rewriting a future conversation-store version', () => {
    const dir = root()
    const future = {
      version: 2,
      conversations: {
        codex: { sessionId: 'future-thread', turns: 9 },
      },
    }
    writeJson(dir, '.cache/agent/session.json', future)

    expect(() => setConversationSession(dir, 'claude', 'new-session')).toThrow(
      'unsupported agent conversation store version: 2',
    )
    expect(readJson<any>(dir, '.cache/agent/session.json', {})).toEqual(future)
  })
})
