import type { AgentEvent, AgentRun } from '@shared/contracts/agent'

import { expect, test } from 'bun:test'

import { type StudioEventEffect, studioEventEffects } from './studio-events'

const AGENT: StudioEventEffect[] = [
  { type: 'invalidate-agent' },
  { type: 'invalidate-agent-history' },
  { type: 'invalidate-chats' },
]

test('each event invalidates its own scope: domain, workspace, chats, or all on reconnect', () => {
  expect(studioEventEffects({ type: 'hello', domains: ['billing'] })).toEqual([
    { type: 'invalidate-domain', domainId: 'billing' },
    ...AGENT,
  ])
  expect(studioEventEffects({ type: 'hello', domains: [] })).toEqual(AGENT)
  expect(
    studioEventEffects({ type: 'schema-diff', domainId: 'billing', renderFingerprint: 'r2' }),
  ).toEqual([{ type: 'invalidate-domain', domainId: 'billing' }, { type: 'invalidate-workspace' }])
  expect(studioEventEffects({ type: 'workspace', domains: ['billing'] })).toEqual([
    { type: 'invalidate-workspace' },
  ])
  expect(studioEventEffects({ type: 'comments', domainId: 'billing' })).toEqual([
    { type: 'invalidate-domain', domainId: 'billing' },
  ])
  expect(studioEventEffects({ type: 'chats' })).toEqual([{ type: 'invalidate-chats' }])
})

test('live agent events merge directly and only terminal runs refresh history', () => {
  const event: AgentEvent = { id: 'e1', ts: '2026-08-28T00:00:00.000Z', kind: 'message', text: 'x' }
  expect(
    studioEventEffects({ type: 'agent-event', chatId: 'chat-1', runId: 'run-1', event }),
  ).toEqual([{ type: 'put-agent-event', chatId: 'chat-1', runId: 'run-1', event }])
  const context = { used: 10, size: 100 }
  expect(
    studioEventEffects({ type: 'agent-context', chatId: 'chat-1', runId: 'run-1', context }),
  ).toEqual([{ type: 'put-agent-context', chatId: 'chat-1', runId: 'run-1', context }])

  const run = (status: AgentRun['status']) =>
    ({ id: 'run-1', chatId: 'chat-1', status, events: [] }) as unknown as AgentRun
  const refresh: StudioEventEffect[] = [
    { type: 'invalidate-agent', chatId: 'chat-1' },
    { type: 'invalidate-chats' },
  ]
  expect(studioEventEffects({ type: 'agent-run', chatId: 'chat-1', run: run('running') })).toEqual([
    { type: 'synchronize-agent-run', run: run('running') },
    ...refresh,
  ])
  expect(
    studioEventEffects({ type: 'agent-run', chatId: 'chat-1', run: run('succeeded') }),
  ).toEqual([
    { type: 'synchronize-agent-run', run: run('succeeded') },
    ...refresh,
    { type: 'invalidate-agent-history', chatId: 'chat-1' },
  ])
})
