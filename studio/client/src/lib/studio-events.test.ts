import type { AgentEvent, AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import { studioEventEffects } from './studio-events'

const run = (status: AgentRun['status']): AgentRun => ({
  id: 'run-1',
  domainId: 'billing',
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

test('live agent events merge directly and only terminal runs refresh history', () => {
  const event: AgentEvent = {
    id: 'event-1',
    ts: '2026-08-28T00:00:00.000Z',
    kind: 'message',
    text: 'Working',
  }
  expect(
    studioEventEffects({ type: 'agent-event', domainId: 'billing', runId: 'run-1', event }),
  ).toEqual([{ type: 'append-agent-event', domainId: 'billing', runId: 'run-1', event }])
  expect(
    studioEventEffects({ type: 'agent-run', domainId: 'billing', run: run('running') }),
  ).toEqual([
    { type: 'synchronize-agent-run', run: run('running') },
    { type: 'invalidate-agent', domainId: 'billing' },
  ])
  expect(
    studioEventEffects({ type: 'agent-run', domainId: 'billing', run: run('succeeded') }),
  ).toEqual([
    { type: 'synchronize-agent-run', run: run('succeeded') },
    { type: 'invalidate-agent', domainId: 'billing' },
    { type: 'invalidate-agent-history', domainId: 'billing' },
  ])
})
