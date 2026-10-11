import type { AgentRun } from '@shared/contracts/agent'

import { expect, test } from 'bun:test'

import {
  conversationContext,
  extendDraft,
  mergeDraft,
  harnessLink,
  isRunActive,
  mergeEvents,
  pendingRun,
  reconcileRun,
  useAgentLive,
} from './agent'

const run = (patch: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  chatId: 'c',
  harness: 'claude',
  status: 'running',
  createdAt: '2026-09-01T10:00:00.000Z',
  summary: '',
  instruction: 'do the thing',
  targetCommentIds: [],
  events: [],
  ...patch,
})

const submitted = (message = 'do the thing', summary = message) =>
  pendingRun({ id: 'pending-1', chatId: 'c', harness: 'claude', message, summary })

test('the server settles a turn the stream missed, and a stale snapshot never un-settles it', () => {
  // the frame that said "canceled" never arrived: the mirror still says running
  const live = run({
    events: [{ id: 'e1', ts: '2026-09-01T10:00:01.000Z', kind: 'status', text: 'working' }],
  })
  const settled = reconcileRun(live, run({ status: 'canceled', finishedAt: 'now' }))
  expect(settled).toMatchObject({ status: 'canceled', finishedAt: 'now' })
  expect(isRunActive(settled)).toBe(false)
  // ...without losing the activity only the stream saw
  expect(settled?.events).toHaveLength(1)
  expect(reconcileRun(run({ status: 'succeeded' }), run())?.status).toBe('succeeded')
})

test('different turns resolve to the newer one, and either side alone is the answer', () => {
  const older = run({ id: 'old', createdAt: '2026-09-01T10:00:00.000Z' })
  const newer = run({ id: 'new', createdAt: '2026-09-01T11:00:00.000Z' })
  expect(reconcileRun(newer, older)?.id).toBe('new')
  expect(reconcileRun(older, newer)?.id).toBe('new')
  expect(reconcileRun(undefined, null)).toBeNull()
  expect(reconcileRun(run(), null)?.id).toBe('run-1')
  expect(reconcileRun(undefined, run())?.id).toBe('run-1')
})

test('a message sent to a free chat is a running turn from the keystroke', () => {
  const shown = submitted()
  expect(shown.instruction).toBe('do the thing')
  expect(isRunActive(shown)).toBe(true)
  expect(shown.events).toEqual([])
  // a turn only carrying documents says so instead of showing an empty message
  const carried = submitted('', '2 documents')
  expect(carried.instruction).toBeUndefined()
  expect(carried.summary).toBe('2 documents')
})

test('a submit that never landed takes its turn back, but never the server’s own', () => {
  const live = useAgentLive.getState()
  live.setRun(submitted())
  live.dropRun('c', 'pending-1')
  expect(useAgentLive.getState().runs.c).toBeUndefined()

  live.setRun(submitted())
  live.setRun(run({ id: 'server-run' }))
  live.dropRun('c', 'pending-1')
  expect(useAgentLive.getState().runs.c?.id).toBe('server-run')
})

test('an agent not reached yet is connecting; one whose read gave up is unreachable', () => {
  expect(harnessLink(undefined)).toBe('connecting')
  expect(harnessLink(true)).toBe('ready')
  expect(harnessLink(false)).toBe('unreachable')
  expect(harnessLink(undefined, true)).toBe('unreachable')
  // an answer beats the failure of a later read
  expect(harnessLink(true, true)).toBe('ready')
})

const tool = (revision: number, status: 'in_progress' | 'completed') => ({
  id: 'call',
  ts: '2026-09-01T10:00:01.000Z',
  kind: 'tool' as const,
  text: 'pnpm test',
  tool: 'execute',
  status,
  revision,
})

test('a tool call reported again updates its step in place, and never goes back', () => {
  const live = useAgentLive.getState()
  live.setRun(run({ id: 'run-tools', chatId: 'tools' }))
  live.putEvent('tools', 'run-tools', tool(1, 'in_progress'))
  live.putEvent('tools', 'run-tools', { id: 'note', ts: 't', kind: 'message', text: 'Running.' })
  live.putEvent('tools', 'run-tools', tool(2, 'completed'))
  live.putEvent('tools', 'run-tools', tool(1, 'in_progress'))
  const events = useAgentLive.getState().runs.tools!.events
  expect(events.map((event) => event.id)).toEqual(['call', 'note'])
  expect(events[0]).toMatchObject({ status: 'completed', revision: 2 })

  // two copies of a run keep the longer list, each step at its furthest revision
  const streamed = [tool(1, 'in_progress'), { ...tool(1, 'in_progress'), id: 'next' }]
  const snapshot = [tool(2, 'completed')]
  const merged = mergeEvents(streamed, snapshot)
  expect(merged.map((event) => event.id)).toEqual(['call', 'next'])
  expect(merged[0]).toMatchObject({ status: 'completed', revision: 2 })
  expect(mergeEvents(snapshot, [tool(1, 'in_progress')])).toBe(snapshot)
})

test('the context window carries over one conversation, and lands only on its own run', () => {
  const full = { used: 150_000, size: 200_000 }
  const earlier = run({ id: 'a', status: 'succeeded', resumed: false, context: full })
  expect(conversationContext([earlier, submitted('go')], true)).toEqual(full)
  // a turn that started a new conversation owns nothing from before it
  expect(conversationContext([earlier, run({ id: 'b', resumed: false })], true)).toBeUndefined()
  expect(conversationContext([earlier], false)).toBeUndefined()

  useAgentLive.setState({ runs: { c: run() } })
  useAgentLive.getState().putContext('c', 'other-run', { used: 1, size: 10 })
  expect(useAgentLive.getState().runs.c?.context).toBeUndefined()
  useAgentLive.getState().putContext('c', 'run-1', { used: 5, size: 10 })
  expect(useAgentLive.getState().runs.c?.context).toEqual({ used: 5, size: 10 })
})

test('a streamed message grows in place, waits on a gap, and ends once written out', () => {
  let draft = extendDraft(undefined, 'm1', 0, 'Hel')
  draft = extendDraft(draft, 'm1', 3, 'lo')
  expect(draft).toEqual({ id: 'm1', text: 'Hello' })
  expect(extendDraft(draft, 'm1', 3, 'lo')).toEqual(draft)
  expect(extendDraft(draft, 'm1', 9, '!')).toBe(draft)
  expect(extendDraft(draft, 'm2', 4, 'xx')).toBe(draft)
  expect(extendDraft(draft, 'm2', 0, 'Next')).toEqual({ id: 'm2', text: 'Next' })

  const events = [{ id: 'm1', ts: 'now', kind: 'message' as const, text: 'Hello' }]
  expect(mergeDraft(draft, undefined, events)).toBeUndefined()
  expect(mergeDraft({ id: 'm1', text: 'Hel' }, draft, [])).toEqual(draft)
  expect(mergeDraft(draft, { id: 'm2', text: 'Ne' }, events)).toEqual({ id: 'm2', text: 'Ne' })
})
