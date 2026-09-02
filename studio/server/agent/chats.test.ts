import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readJson, writeJson } from '../state/store'
import {
  activeChat,
  chatInfo,
  chatQueue,
  clearChatHandoff,
  clearChatSession,
  createChat,
  deleteChat,
  ensureChats,
  forkChat,
  editQueuedMessage,
  enqueueChatMessage,
  markHandoffDelivered,
  moveQueuedMessage,
  pendingHandoff,
  recordChatTurn,
  renameChat,
  requeueChatMessage,
  resolveChat,
  setActiveChat,
  setChatModel,
  setChatSession,
  takeQueuedMessage,
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
    writeJson(dir, 'active-chat.json', { activeId: 'ghost' })
    expect(ensureChats(dir, 'claude').activeId).toBe(chat.id)
  })

  test('machine-global chats keep an independent active pointer per workspace', () => {
    const machine = root()
    const workspaceA = root()
    const workspaceB = root()
    const first = activeChat(machine, 'claude', { workspace: '/work/a' }, workspaceA)
    const second = createChat(machine, { harness: 'codex', workspace: '/work/b' }, workspaceB)

    expect(ensureChats(machine, 'claude', undefined, workspaceA)).toEqual(
      expect.objectContaining({
        activeId: first.id,
        chats: expect.arrayContaining([
          expect.objectContaining({ id: first.id }),
          expect.objectContaining({ id: second.id }),
        ]),
      }),
    )
    expect(ensureChats(machine, 'claude', undefined, workspaceB).activeId).toBe(second.id)
  })

  test('an empty session id clears rather than stores a blank conversation', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    setChatSession(dir, chat.id, 'session-1')
    setChatSession(dir, chat.id, '   ')
    expect(resolveChat(dir, 'claude', chat.id)?.sessionId).toBeUndefined()
  })
})

describe('queued messages', () => {
  const texts = (dir: string, chatId: string): string[] =>
    chatQueue(resolveChat(dir, 'claude', chatId)!).map((message) => message.text)

  test('messages queue in the order they were sent and travel with the tab', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    const other = createChat(dir, { harness: 'codex' })

    const first = enqueueChatMessage(dir, chat.id, '  first  ')!
    enqueueChatMessage(dir, chat.id, 'second')
    enqueueChatMessage(dir, other.id, 'not this tab')

    // trimmed on the way in, appended at the back, and never crossing tabs
    expect(first.text).toBe('first')
    expect(texts(dir, chat.id)).toEqual(['first', 'second'])
    expect(texts(dir, other.id)).toEqual(['not this tab'])
    expect(chatInfo(resolveChat(dir, 'claude', chat.id)!, 'running').queued).toHaveLength(2)

    // an unqueued tab reports an empty list rather than nothing
    expect(chatInfo(other, 'idle').queued).toEqual([])
  })

  test('the next message is taken from the front, and goes back there if it cannot run', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    enqueueChatMessage(dir, chat.id, 'one')
    enqueueChatMessage(dir, chat.id, 'two')

    const next = takeQueuedMessage(dir, chat.id)!
    expect(next.text).toBe('one')
    expect(texts(dir, chat.id)).toEqual(['two'])

    // a submit that never started must not silently reorder what is left
    requeueChatMessage(dir, chat.id, next)
    expect(texts(dir, chat.id)).toEqual(['one', 'two'])
    expect(takeQueuedMessage(dir, chat.id, 'no-such-message')).toBeUndefined()
    expect(texts(dir, chat.id)).toEqual(['one', 'two'])
  })

  test('reordering stops at both ends, and rewriting refuses to empty a message', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    const one = enqueueChatMessage(dir, chat.id, 'one')!
    const two = enqueueChatMessage(dir, chat.id, 'two')!

    expect(moveQueuedMessage(dir, chat.id, two.id, -1)).toBe(true)
    expect(texts(dir, chat.id)).toEqual(['two', 'one'])
    expect(moveQueuedMessage(dir, chat.id, two.id, -1)).toBe(false)
    expect(moveQueuedMessage(dir, chat.id, one.id, 1)).toBe(false)
    expect(texts(dir, chat.id)).toEqual(['two', 'one'])

    expect(editQueuedMessage(dir, chat.id, one.id, '  one, revised ')).toMatchObject({
      id: one.id,
      text: 'one, revised',
    })
    // a blank rewrite is a delete in disguise, and deleting has its own control
    expect(editQueuedMessage(dir, chat.id, one.id, '   ')).toBeUndefined()
    expect(texts(dir, chat.id)).toEqual(['two', 'one, revised'])
  })

  test('a queue survives a restart, and a corrupt entry is dropped rather than fatal', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    enqueueChatMessage(dir, chat.id, 'still here')

    const store = readJson<Record<string, unknown> | null>(
      dir,
      `chats/${chat.id}.json`,
      (value) => value as Record<string, unknown>,
      null,
    )!
    store.queue = [{ id: 'kept', text: 'kept' }, { text: 'no id' }, 'nonsense']
    writeJson(dir, `chats/${chat.id}.json`, store)

    expect(texts(dir, chat.id)).toEqual(['kept'])
  })

  test('closing a tab takes its queue with it', () => {
    const dir = root()
    const chat = activeChat(dir, 'claude')
    createChat(dir, { harness: 'claude' })
    enqueueChatMessage(dir, chat.id, 'never sent')

    expect(deleteChat(dir, chat.id)).toBe(true)
    expect(resolveChat(dir, 'claude', chat.id)).toBeUndefined()
    expect(enqueueChatMessage(dir, chat.id, 'too late')).toBeUndefined()
  })
})
