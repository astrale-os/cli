import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UnreadableState } from '../state/state-file'
import { readJson, readState, writeJson, writeState } from '../state/store'
import {
  activeChat,
  chatExists,
  chatInfo,
  chatQueue,
  clearChatHandoff,
  clearChatSession,
  createChat,
  deleteChat,
  enqueueChatMessage,
  ensureChats,
  forkChat,
  markHandoffDelivered,
  renameChat,
  requeueChatMessage,
  resolveChat,
  setActiveChat,
  setChatModel,
  setChatOrder,
  takeQueuedMessage,
  unreadableChatFiles,
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

test('a queue keeps its order on a failed take', () => {
  const dir = root()
  const chat = activeChat(dir, 'claude')
  enqueueChatMessage(dir, chat.id, 'one')
  enqueueChatMessage(dir, chat.id, 'two')
  const texts = () => chatQueue(resolveChat(dir, 'claude', chat.id)!).map(({ text }) => text)

  // a submit that never started puts its message back where it was
  requeueChatMessage(dir, chat.id, takeQueuedMessage(dir, chat.id)!)
  expect(texts()).toEqual(['one', 'two'])
})

/** What a request naming a chat whose file is not read whole meets: a refusal, with why. */
function refusal(run: () => unknown): UnreadableState {
  try {
    run()
  } catch (error) {
    if (error instanceof UnreadableState) return error
    throw error
  }
  throw new Error('the request was not refused')
}

test('a chat file not read whole is left out of the tabs, refused by name, and never written over', () => {
  const dir = root()
  const kept = activeChat(dir, 'claude')
  const broken = createChat(dir, { harness: 'claude' })
  const file = `chats/${broken.id}.json`
  const cases: [string, string, RegExp][] = [
    ['not JSON', '{ "id": ', /^it is not JSON/],
    [
      'a queued message this Studio does not decode',
      JSON.stringify({
        ...JSON.parse(readState(dir, file)!),
        queue: [{ id: 'kept', text: 'kept' }, { text: 'no id' }],
      }),
      /^queued message 2 has no id$/,
    ],
    [
      'a value of a known key it does not decode',
      JSON.stringify({ ...JSON.parse(readState(dir, file)!), turns: 'many' }),
      /^turns is not a count$/,
    ],
    [
      'another chat’s id',
      JSON.stringify({ ...JSON.parse(readState(dir, file)!), id: kept.id }),
      new RegExp(`^it does not name chat ${broken.id} as its id$`),
    ],
  ]
  for (const [, bytes, reason] of cases) {
    writeState(dir, file, bytes)
    // the tabs read whole are listed, and the broken one is not taken for one closed
    expect(ensureChats(dir, 'claude').chats.map((chat) => chat.id)).toEqual([kept.id])
    expect(chatExists(dir, broken.id)).toBe(true)
    const named = refusal(() => resolveChat(dir, 'claude', broken.id))
    expect(named.path.endsWith(file)).toBe(true)
    expect(named.reason).toMatch(reason)
    // every write naming it is refused, the file left as it is
    for (const write of [
      () => renameChat(dir, broken.id, 'renamed'),
      () => setChatModel(dir, broken.id, 'other'),
      () => enqueueChatMessage(dir, broken.id, 'more'),
      () => takeQueuedMessage(dir, broken.id),
      () => clearChatHandoff(dir, broken.id),
      () => setActiveChat(dir, broken.id),
      () => deleteChat(dir, broken.id),
    ])
      expect(refusal(write).reason).toMatch(reason)
    expect(readState(dir, file)).toBe(bytes)
  }
  // a new tab takes a new file, and the active one is still the one read whole
  expect(createChat(dir, { harness: 'codex' }).id).not.toBe(broken.id)
  expect(readState(dir, file)).toBe(cases.at(-1)![1])
})

test("the active pointer and the tabs' order not read whole read as none, are named, and are never written over", () => {
  const dir = root()
  const first = activeChat(dir, 'claude')
  // age order is by creation time: the second tab is made a tick later
  Bun.sleepSync(2)
  const second = createChat(dir, { harness: 'claude' })
  setChatOrder(dir, [second.id, first.id])
  expect(unreadableChatFiles(dir)).toEqual([])

  const pointer = '{ "activeId": '
  const order = JSON.stringify({ order: 'b, a' })
  writeState(dir, 'active-chat.json', pointer)
  writeState(dir, 'chat-order.json', order)
  // the tabs still open, in age order, on the newest
  const store = ensureChats(dir, 'claude')
  expect(store.chats.map((chat) => chat.id)).toEqual([first.id, second.id])
  expect(store.activeId).toBe(second.id)
  // each file left out is named, with why
  const named = unreadableChatFiles(dir)
  expect(named.map((file) => [file.path.split('/').at(-1), file.reason])).toEqual([
    ['active-chat.json', expect.stringMatching(/^it is not JSON/)],
    ['chat-order.json', 'order is not a list of chat ids'],
  ])
  // every write to them is refused, before anything else is written
  expect(refusal(() => setActiveChat(dir, first.id)).path.endsWith('active-chat.json')).toBe(true)
  expect(refusal(() => setChatOrder(dir, [first.id])).path.endsWith('chat-order.json')).toBe(true)
  expect(refusal(() => deleteChat(dir, first.id)).path.endsWith('chat-order.json')).toBe(true)
  expect(refusal(() => createChat(dir, { harness: 'codex' })).reason).toMatch(/^it is not JSON/)
  expect(ensureChats(dir, 'claude').chats).toHaveLength(2)
  expect(readState(dir, 'active-chat.json')).toBe(pointer)
  expect(readState(dir, 'chat-order.json')).toBe(order)

  // a chat file not read whole is named by its chat
  writeState(dir, 'active-chat.json', JSON.stringify({ activeId: first.id, pinned: 'newer' }))
  writeState(dir, `chats/${second.id}.json`, '{')
  expect(unreadableChatFiles(dir).map((file) => file.chatId)).toEqual([second.id, undefined])
  // a key this Studio does not know is kept through a write of the pointer
  writeState(dir, 'chat-order.json', JSON.stringify({ order: [first.id] }))
  createChat(dir, { harness: 'claude' })
  expect(JSON.parse(readState(dir, 'active-chat.json')!).pinned).toBe('newer')
})

test('a key this Studio does not know is kept through every write, and one it knows goes when cleared', () => {
  const dir = root()
  const chat = activeChat(dir, 'claude')
  const file = `chats/${chat.id}.json`
  enqueueChatMessage(dir, chat.id, 'first')
  const stored = JSON.parse(readState(dir, file)!)
  writeJson(dir, file, {
    ...stored,
    sessionId: 'session-1',
    // what an older Studio may have written for a key it left empty
    model: null,
    pinnedBy: { window: 'newer' },
    handoff: {
      fromChatId: 'source',
      fromHarness: 'codex',
      createdAt: stored.createdAt,
      summary: 'so far',
      channel: 'newer',
    },
    queue: [{ ...stored.queue[0], priority: 'high' }],
  })

  renameChat(dir, chat.id, 'Renamed')
  enqueueChatMessage(dir, chat.id, 'second')
  takeQueuedMessage(dir, chat.id, chatQueue(resolveChat(dir, 'claude', chat.id)!)[1]!.id)
  markHandoffDelivered(dir, chat.id)
  clearChatSession(dir, chat.id)

  const after = JSON.parse(readState(dir, file)!)
  expect(after.title).toBe('Renamed')
  expect(after.pinnedBy).toEqual({ window: 'newer' })
  expect(after.handoff).toMatchObject({ delivered: true, channel: 'newer' })
  expect(after.queue).toEqual([{ ...stored.queue[0], priority: 'high' }])
  // a key it knows is gone when this Studio clears it, never put back
  expect('sessionId' in after).toBe(false)
  expect('model' in after).toBe(false)
  expect(
    chatInfo(resolveChat(dir, 'claude', chat.id)!, 'idle').queued.map(({ text }) => text),
  ).toEqual(['first'])
})
