import type { AgentEvent, AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import { studioEventEffects } from './studio-events'

const run = (status: AgentRun['status']): AgentRun => ({
  id: 'run-1',
  chatId: 'chat-1',
  harness: 'codex',
  status,
  createdAt: '2026-08-28T00:00:00.000Z',
  summary: 'Test run',
  targetCommentIds: [],
  events: [],
})

test('reconnect resynchronizes every announced domain and the workspace agent', () => {
  expect(studioEventEffects({ type: 'hello', domains: ['billing'] })).toEqual([
    { type: 'invalidate-domain', domainId: 'billing' },
    { type: 'invalidate-agent' },
    { type: 'invalidate-agent-history' },
    { type: 'invalidate-chats' },
  ])
  expect(studioEventEffects({ type: 'hello', domains: [] })).toEqual([
    { type: 'invalidate-agent' },
    { type: 'invalidate-agent-history' },
    { type: 'invalidate-chats' },
  ])
})

test('schema and workspace events preserve their distinct invalidation scopes', () => {
  expect(
    studioEventEffects({
      type: 'schema-diff',
      domainId: 'billing',
      renderFingerprint: 'render-2',
    }),
  ).toEqual([{ type: 'invalidate-domain', domainId: 'billing' }, { type: 'invalidate-workspace' }])
  expect(studioEventEffects({ type: 'workspace', domains: ['billing'] })).toEqual([
    { type: 'invalidate-workspace' },
  ])
  expect(studioEventEffects({ type: 'comments', domainId: 'billing' })).toEqual([
    { type: 'invalidate-domain', domainId: 'billing' },
  ])
})

test('a queue change refreshes the strip and nothing else', () => {
  // the queue lives on the chat, so the tab strip is the only thing to resync —
  // no run started, no transcript moved
  expect(studioEventEffects({ type: 'chats' })).toEqual([{ type: 'invalidate-chats' }])
})

test('live agent events merge directly and only terminal runs refresh history', () => {
  const event: AgentEvent = {
    id: 'event-1',
    ts: '2026-08-28T00:00:00.000Z',
    kind: 'message',
    text: 'Working',
  }
  expect(
    studioEventEffects({
      type: 'agent-event',
      chatId: 'chat-1',
      runId: 'run-1',
      event,
    }),
  ).toEqual([{ type: 'append-agent-event', chatId: 'chat-1', runId: 'run-1', event }])
  expect(
    studioEventEffects({
      type: 'agent-run',
      chatId: 'chat-1',
      run: run('running'),
    }),
  ).toEqual([
    { type: 'synchronize-agent-run', run: run('running') },
    { type: 'invalidate-agent', chatId: 'chat-1' },
    { type: 'invalidate-chats' },
  ])
  expect(
    studioEventEffects({
      type: 'agent-run',
      chatId: 'chat-1',
      run: run('succeeded'),
    }),
  ).toEqual([
    { type: 'synchronize-agent-run', run: run('succeeded') },
    { type: 'invalidate-agent', chatId: 'chat-1' },
    { type: 'invalidate-chats' },
    { type: 'invalidate-agent-history', chatId: 'chat-1' },
  ])
})
