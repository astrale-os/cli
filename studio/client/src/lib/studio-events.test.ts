import type { AgentEvent, AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import { studioEventEffects } from './studio-events'

const run = (status: AgentRun['status']): AgentRun => ({
  id: 'run-1',
  domainId: 'billing',
  chatId: 'chat-1',
  harness: 'codex',
  status,
  createdAt: '2026-08-28T00:00:00.000Z',
  summary: 'Test run',
  targetCommentIds: [],
  events: [],
})

test('reconnect resynchronizes only the current domain and its agent transcript', () => {
  expect(studioEventEffects({ type: 'hello', domains: ['billing'] }, 'billing')).toEqual([
    { type: 'invalidate-domain', domainId: 'billing' },
    { type: 'invalidate-agent', domainId: 'billing' },
    { type: 'invalidate-agent-history', domainId: 'billing' },
    { type: 'invalidate-chats', domainId: 'billing' },
  ])
  expect(studioEventEffects({ type: 'hello', domains: [] })).toEqual([])
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
  expect(studioEventEffects({ type: 'chats', domainId: 'billing' })).toEqual([
    { type: 'invalidate-chats', domainId: 'billing' },
  ])
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
      domainId: 'billing',
      chatId: 'chat-1',
      runId: 'run-1',
      event,
    }),
  ).toEqual([{ type: 'append-agent-event', chatId: 'chat-1', runId: 'run-1', event }])
  expect(
    studioEventEffects({
      type: 'agent-run',
      domainId: 'billing',
      chatId: 'chat-1',
      run: run('running'),
    }),
  ).toEqual([
    { type: 'synchronize-agent-run', run: run('running') },
    { type: 'invalidate-agent', domainId: 'billing', chatId: 'chat-1' },
    { type: 'invalidate-chats', domainId: 'billing' },
  ])
  expect(
    studioEventEffects({
      type: 'agent-run',
      domainId: 'billing',
      chatId: 'chat-1',
      run: run('succeeded'),
    }),
  ).toEqual([
    { type: 'synchronize-agent-run', run: run('succeeded') },
    { type: 'invalidate-agent', domainId: 'billing', chatId: 'chat-1' },
    { type: 'invalidate-chats', domainId: 'billing' },
    { type: 'invalidate-agent-history', domainId: 'billing', chatId: 'chat-1' },
  ])
})
