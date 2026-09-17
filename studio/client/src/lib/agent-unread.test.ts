import type { AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import { createAgentUnreadStore } from './agent-unread'

const run = (patch: Partial<AgentRun> = {}): AgentRun => ({
  id: 'turn-1',
  chatId: 'chat-1',
  harness: 'claude',
  status: 'succeeded',
  createdAt: '2026-09-16T10:00:00.000Z',
  summary: 'Update the schema',
  targetCommentIds: [],
  events: [],
  ...patch,
})

function fixture() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  return { store: createAgentUnreadStore(storage), storage }
}

test('completion remains unread through a queued next turn and a browser reload', () => {
  const { store, storage } = fixture()
  store.getState().completed(run({ status: 'running' }))
  expect(store.getState().receipts).toEqual({})
  store.getState().completed(run())
  store.getState().completed(run({ id: 'turn-2', status: 'queued' }))
  const reloaded = createAgentUnreadStore(storage)
  expect(reloaded.getState().receipts['chat-1']).toMatchObject({
    key: 'turn-1:succeeded',
    unread: true,
    failed: false,
  })
  reloaded.getState().read('chat-1', 'turn-1:succeeded')
  const reopened = createAgentUnreadStore(storage)
  reopened.getState().completed(run())
  expect(reopened.getState().receipts['chat-1']?.unread).toBe(false)
})

test('reading one chat cannot clear another chat or a newer response', () => {
  const { store } = fixture()
  store.getState().completed(run())
  store.getState().completed(run({ chatId: 'chat-2', status: 'failed' }))
  store.getState().completed(run({ id: 'turn-2', createdAt: '2026-09-16T11:00:00.000Z' }))
  store.getState().read('chat-1', 'turn-1:succeeded')
  expect(store.getState().receipts['chat-1']?.unread).toBe(true)
  store.getState().read('chat-1', 'turn-2:succeeded')
  store.getState().completed(run()) // stale HTTP response after a newer completion
  expect(store.getState().receipts['chat-1']).toMatchObject({
    key: 'turn-2:succeeded',
    unread: false,
  })
  expect(store.getState().receipts['chat-2']).toMatchObject({ unread: true, failed: true })
})

test('an interrupted run needs attention; stopping without a reply creates no unread message', () => {
  const { store } = fixture()
  store.getState().completed(run({ status: 'canceled' }))
  expect(store.getState().receipts).toEqual({})
  store.getState().completed(run({ status: 'interrupted' }))
  expect(store.getState().receipts['chat-1']).toMatchObject({ unread: true, failed: true })
})
