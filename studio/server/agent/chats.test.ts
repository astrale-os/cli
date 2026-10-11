import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readJson, writeJson } from '../state/store'
import {
  activeChat,
  chatInfo,
  chatQueue,
  clearChatHandoff,
  createChat,
  deleteChat,
  enqueueChatMessage,
  ensureChats,
  forkChat,
  markHandoffDelivered,
  requeueChatMessage,
  resolveChat,
  setActiveChat,
  setChatOrder,
  takeQueuedMessage,
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

test('a store always has an active tab whose id survives every read', () => {
  const dir = root()
  const first = activeChat(dir, 'claude')
  expect(first).toMatchObject({ harness: 'claude', turns: 0, title: 'New chat' })
  // a regenerated id would orphan the tab's transcript on the very next read
  expect(activeChat(dir, 'claude').id).toBe(first.id)

  expect(setActiveChat(dir, 'does-not-exist')).toBe(false)
  writeJson(dir, 'active-chat.json', { activeId: 'ghost' })
  expect(ensureChats(dir, 'claude').activeId).toBe(first.id)

  // the last tab may close: the next read seeds a fresh one
  expect(deleteChat(dir, first.id)).toBe(true)
  expect(activeChat(dir, 'codex')).toMatchObject({ harness: 'codex' })
})

test('a chat keeps its tone for life, whatever tab closes', () => {
  const dir = root()
  const first = activeChat(dir, 'claude')
  const second = createChat(dir, { harness: 'claude' })
  const third = createChat(dir, { harness: 'claude' })
  expect([first.tone, second.tone, third.tone]).toEqual([0, 1, 2])

  deleteChat(dir, second.id)
  expect(chatInfo(resolveChat(dir, 'claude', third.id)!, 'idle').tone).toBe(2)
  // the freed hue goes to the next tab, not the survivor's
  expect(createChat(dir, { harness: 'claude' }).tone).toBe(1)
  // closing the brand tab hands the brand to the next chat of that agent only
  deleteChat(dir, first.id)
  expect(createChat(dir, { harness: 'claude' }).tone).toBe(0)
})

test('keeps the order tabs were arranged in, new ones last', () => {
  const dir = root()
  // three tabs opened a second apart, as chats opened within one millisecond tie
  for (const [index, id] of ['a', 'b', 'c'].entries())
    writeJson(dir, `chats/${id}.json`, {
      id,
      title: 'New chat',
      harness: 'claude',
      tone: index,
      turns: 0,
      createdAt: `2026-09-01T00:00:0${index}.000Z`,
      updatedAt: `2026-09-01T00:00:0${index}.000Z`,
    })
  const ids = () => ensureChats(dir, 'claude').chats.map((chat) => chat.id)
  expect(ids()).toEqual(['a', 'b', 'c'])

  // an unknown id is ignored, and a tab the caller did not name keeps its place after
  setChatOrder(dir, ['c', 'gone', 'a'])
  const fourth = createChat(dir, { harness: 'claude' })
  expect(ids()).toEqual(['c', 'a', 'b', fourth.id])

  deleteChat(dir, 'a')
  expect(readJson(dir, 'chat-order.json', (value) => value, undefined)).toEqual({
    order: ['c', 'b'],
  })
})

test('machine-global chats keep an independent active pointer per workspace', () => {
  const machine = root()
  const [workspaceA, workspaceB] = [root(), root()]
  const first = activeChat(machine, 'claude', { workspace: '/work/a' }, workspaceA)
  const second = createChat(machine, { harness: 'codex', workspace: '/work/b' }, workspaceB)

  expect(ensureChats(machine, 'claude', undefined, workspaceA).activeId).toBe(first.id)
  expect(ensureChats(machine, 'claude', undefined, workspaceB).activeId).toBe(second.id)
  expect(ensureChats(machine, 'claude', undefined, workspaceA).chats).toHaveLength(2)
})

test('a fork briefs the new tab once, keeps the briefing as its chip, and leaves the source', () => {
  const dir = root()
  const source = activeChat(dir, 'claude')
  const forked = forkChat(dir, source, 'codex', 'what happened so far', 'gpt-5.6-sol')
  expect(forked).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol', turns: 0 })
  expect(forked.sessionId).toBeUndefined()
  expect(ensureChats(dir, 'claude').activeId).toBe(forked.id)

  // an unsent briefing may be discarded…
  const other = forkChat(dir, source, 'codex', 'not sent yet')
  expect(clearChatHandoff(dir, other.id)).toBe('cleared')
  // …a delivered one is conversation history: it stays, and is never sent again
  markHandoffDelivered(dir, forked.id)
  expect(clearChatHandoff(dir, forked.id)).toBe('delivered')
  expect(chatInfo(resolveChat(dir, 'claude', forked.id)!, 'idle').origin).toEqual({
    chatId: source.id,
    harness: 'claude',
    pendingHandoff: false,
    summary: 'what happened so far',
  })
})

test('a queue keeps its order on a failed take and drops corrupt entries on read', () => {
  const dir = root()
  const chat = activeChat(dir, 'claude')
  enqueueChatMessage(dir, chat.id, 'one')
  enqueueChatMessage(dir, chat.id, 'two')
  const texts = () => chatQueue(resolveChat(dir, 'claude', chat.id)!).map(({ text }) => text)

  // a submit that never started puts its message back where it was
  requeueChatMessage(dir, chat.id, takeQueuedMessage(dir, chat.id)!)
  expect(texts()).toEqual(['one', 'two'])

  const stored = readJson<Record<string, unknown> | null>(
    dir,
    `chats/${chat.id}.json`,
    (value) => value as Record<string, unknown>,
    null,
  )!
  writeJson(dir, `chats/${chat.id}.json`, {
    ...stored,
    queue: [{ id: 'kept', text: 'kept' }, { text: 'no id' }, 'nonsense'],
  })
  expect(texts()).toEqual(['kept'])
})
