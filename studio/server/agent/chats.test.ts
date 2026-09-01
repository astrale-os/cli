import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readJson, writeJson } from '../state/store'
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
  recordChatTurn,
  renameChat,
  resolveChat,
  setActiveChat,
  setChatModel,
  setChatSession,
  titleChatFromMessage,
} from './chats'

const roots: string[] = []
const root = () => {
  const value = mkdtempSync(join(tmpdir(), 'studio-chats-'))
  roots.push(value)
  return value
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('chat tabs', () => {
  test('seeds one chat on the default harness and keeps its id across reads', () => {
    const dir = root()
    const first = activeChat(dir, 'claude')
    expect(first).toMatchObject({ harness: 'claude', turns: 0, title: 'New chat' })

    // A regenerated id would orphan the tab's transcript on the very next read.
    expect(activeChat(dir, 'claude').id).toBe(first.id)
    expect(ensureChats(dir, 'claude').chats).toHaveLength(1)
  })

  test('keeps each tab’s session, model and turn count to itself', () => {
    const dir = root()
    const claude = activeChat(dir, 'claude')
    const codex = createChat(dir, { harness: 'codex' })

    recordChatTurn(dir, claude.id, { sessionId: 'claude-session', turns: 2 })
    recordChatTurn(dir, codex.id, { sessionId: 'codex-thread', turns: 5 })
    setChatModel(dir, claude.id, 'opus')
    setChatModel(dir, codex.id, 'gpt-5.6')

    expect(resolveChat(dir, 'claude', claude.id)).toMatchObject({
      sessionId: 'claude-session',
      turns: 2,
      model: 'opus',
      harness: 'claude',
    })
    expect(resolveChat(dir, 'claude', codex.id)).toMatchObject({
      sessionId: 'codex-thread',
      turns: 5,
      model: 'gpt-5.6',
      harness: 'codex',
    })

    clearChatSession(dir, codex.id)
    expect(resolveChat(dir, 'claude', codex.id)?.sessionId).toBeUndefined()
    expect(resolveChat(dir, 'claude', codex.id)?.turns).toBe(0)
    expect(resolveChat(dir, 'claude', claude.id)?.sessionId).toBe('claude-session')
  })

  test('forking carries a briefing to the new tab and leaves the source untouched', () => {
    const dir = root()
    const source = activeChat(dir, 'claude')
    renameChat(dir, source.id, 'Billing rework')
    recordChatTurn(dir, source.id, { sessionId: 'claude-session', turns: 3 })

    const forked = forkChat(dir, source, 'codex', 'what happened so far', 'gpt-5.6-sol')
    expect(forked.model).toBe('gpt-5.6-sol')
    expect(forked).toMatchObject({
      harness: 'codex',
      turns: 0,
      handoff: { fromChatId: source.id, fromHarness: 'claude', summary: 'what happened so far' },
    })
    // a fork starts its own conversation — it cannot inherit the other agent's id
    expect(forked.sessionId).toBeUndefined()
    // the fork is where the user lands, and the original is exactly as it was
    expect(ensureChats(dir, 'claude').activeId).toBe(forked.id)
    expect(resolveChat(dir, 'claude', source.id)).toMatchObject({
      harness: 'claude',
      sessionId: 'claude-session',
      turns: 3,
      title: 'Billing rework',
    })

    expect(chatInfo(forked, 'idle').origin).toEqual({
      chatId: source.id,
      harness: 'claude',
      pendingHandoff: true,
      summary: 'what happened so far',
    })
    expect(pendingHandoff(forked)).toBe('what happened so far')

    // Delivery stops the RESEND, it does not erase the briefing: the chip above
    // the transcript is this conversation's only record of where it came from.
    markHandoffDelivered(dir, forked.id)
    const delivered = resolveChat(dir, 'claude', forked.id)!
    expect(pendingHandoff(delivered)).toBeUndefined()
    expect(chatInfo(delivered, 'idle').origin).toEqual({
      chatId: source.id,
      harness: 'claude',
      pendingHandoff: false,
      summary: 'what happened so far',
    })
    expect(clearChatHandoff(dir, forked.id)).toBe('delivered')
    expect(resolveChat(dir, 'claude', forked.id)?.handoff?.summary).toBe('what happened so far')
  })

  test('an unsent briefing can still be discarded', () => {
    const dir = root()
    const source = activeChat(dir, 'claude')
    const forked = forkChat(dir, source, 'codex', 'context not sent yet')

    expect(clearChatHandoff(dir, forked.id)).toBe('cleared')
    expect(resolveChat(dir, 'claude', forked.id)?.handoff).toBeUndefined()
  })

  test('titles an unnamed tab from its first instruction, then leaves it alone', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')

    titleChatFromMessage(dir, chat.id, 'Add a Subscription class\nwith a renewal date')
    expect(resolveChat(dir, 'claude', chat.id)?.title).toBe('Add a Subscription class')

    titleChatFromMessage(dir, chat.id, 'and now something else')
    expect(resolveChat(dir, 'claude', chat.id)?.title).toBe('Add a Subscription class')
  })

  test('closing the last tab is allowed and the next read seeds a fresh one', () => {
    const dir = root()
    const only = activeChat(dir, 'claude')

    expect(deleteChat(dir, only.id)).toBe(true)
    expect(deleteChat(dir, only.id)).toBe(false)

    const seeded = activeChat(dir, 'codex')
    expect(seeded.id).not.toBe(only.id)
    expect(seeded.harness).toBe('codex')
  })

  test('selecting an unknown chat fails instead of silently switching tabs', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    expect(setActiveChat(dir, 'does-not-exist')).toBe(false)
    expect(ensureChats(dir, 'claude').activeId).toBe(chat.id)
  })

  test('a stored active id that no longer exists falls back to a real tab', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    writeJson(dir, '.cache/agent/chats.json', {
      version: 2,
      activeId: 'ghost',
      chats: [chat],
    })
    expect(ensureChats(dir, 'claude').activeId).toBe(chat.id)
  })

  test('migrates the pre-tabs store into one adopting tab per harness', () => {
    const dir = root()
    writeJson(dir, '.cache/agent/session.json', {
      version: 1,
      conversations: {
        claude: { sessionId: 'claude-session', turns: 4, updatedAt: 'then' },
        codex: { sessionId: 'codex-thread', turns: 1, updatedAt: 'then' },
      },
    })

    const chats = ensureChats(dir, 'claude').chats
    expect(chats).toHaveLength(2)
    expect(
      chats.map((chat) => [chat.harness, chat.sessionId, chat.turns, chat.adoptsLegacyRuns]),
    ).toEqual([
      ['claude', 'claude-session', 4, true],
      ['codex', 'codex-thread', 1, true],
    ])
    // the migration is persisted, so the ids stay stable for those transcripts
    expect(
      readJson(dir, '.cache/agent/chats.json', (v) => v as { chats: unknown[] }, null)?.chats,
    ).toHaveLength(2)
  })

  test('migrates the oldest flat single-session shape too', () => {
    const dir = root()
    writeJson(dir, '.cache/agent/session.json', {
      harness: 'claude',
      sessionId: 'legacy-session',
      turns: 6,
    })
    expect(ensureChats(dir, 'codex').chats).toEqual([
      expect.objectContaining({ harness: 'claude', sessionId: 'legacy-session', turns: 6 }),
    ])
  })

  test('rejects a store written by a newer Studio rather than dropping its chats', () => {
    const dir = root()
    writeJson(dir, '.cache/agent/chats.json', { version: 3, activeId: '', chats: [] })
    expect(() => ensureChats(dir, 'claude').chats).toThrow(/unsupported agent chat store version/)
  })

  test('an empty session id clears rather than stores a blank conversation', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    setChatSession(dir, chat.id, 'session-1')
    setChatSession(dir, chat.id, '   ')
    expect(resolveChat(dir, 'claude', chat.id)?.sessionId).toBeUndefined()
  })
})
