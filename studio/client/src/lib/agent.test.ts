import type { AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import {
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

test('the server ends a turn the stream never reported ending', () => {
  // the frame that said "canceled" never arrived: the mirror still says running
  const live = run({
    events: [{ id: 'e1', ts: '2026-09-01T10:00:01.000Z', kind: 'status', text: 'working' }],
  })
  const settled = reconcileRun(live, run({ status: 'canceled', finishedAt: 'now' }))
  expect(settled?.status).toBe('canceled')
  expect(isRunActive(settled)).toBe(false)
  // ...without losing the activity only the stream saw
  expect(settled?.events).toHaveLength(1)
  expect(settled?.finishedAt).toBe('now')
})

test('a stale snapshot never un-finishes a turn the stream already settled', () => {
  const live = run({ status: 'succeeded' })
  expect(reconcileRun(live, run({ status: 'running' }))?.status).toBe('succeeded')
})

test('different turns resolve to the newer one, whichever side holds it', () => {
  const older = run({ id: 'old', createdAt: '2026-09-01T10:00:00.000Z' })
  const newer = run({ id: 'new', createdAt: '2026-09-01T11:00:00.000Z' })
  // just submitted: the mirror has it before the snapshot refetches
  expect(reconcileRun(newer, older)?.id).toBe('new')
  // started from another window: the snapshot has it before the frame lands
  expect(reconcileRun(older, newer)?.id).toBe('new')
})

test('either side alone is the answer', () => {
  expect(reconcileRun(undefined, null)).toBeNull()
  expect(reconcileRun(run(), null)?.id).toBe('run-1')
  expect(reconcileRun(undefined, run())?.id).toBe('run-1')
})

const submitted = () =>
  pendingRun({
    id: 'pending-1',
    chatId: 'c',
    harness: 'claude',
    message: 'do the thing',
    summary: 'do the thing',
  })

test('a message sent to a free chat is a turn from the keystroke, not a queue entry', () => {
  const shown = submitted()
  // it reads as the conversation's own turn: your words, and an agent on them
  expect(shown.instruction).toBe('do the thing')
  expect(isRunActive(shown)).toBe(true)
  expect(shown.events).toEqual([])
})

test('a turn only carrying documents says so instead of showing an empty message', () => {
  const carried = pendingRun({
    id: 'pending-2',
    chatId: 'c',
    harness: 'claude',
    message: '',
    summary: '2 documents',
  })
  expect(carried.instruction).toBeUndefined()
  expect(carried.summary).toBe('2 documents')
})

test('a submit that never landed takes its turn back', () => {
  const shown = submitted()
  useAgentLive.getState().setRun(shown)
  expect(useAgentLive.getState().runs.c?.id).toBe('pending-1')

  useAgentLive.getState().dropRun('c', shown.id)
  expect(useAgentLive.getState().runs.c).toBeUndefined()
})

test('the real turn replaces the shown one, and taking that one back is then a no-op', () => {
  const shown = submitted()
  useAgentLive.getState().setRun(shown)
  useAgentLive.getState().setRun(run({ id: 'server-run', chatId: 'c' }))

  // `drop` runs after the server's answer either way — it must not take the turn
  // the server just gave us with it
  useAgentLive.getState().dropRun('c', shown.id)
  expect(useAgentLive.getState().runs.c?.id).toBe('server-run')
})

test('an agent Studio has not reached yet is not an agent that is not there', () => {
  // the whole point of the third state: the ACP handshake takes seconds, and for
  // those seconds the composer used to say the same word it says for a missing CLI
  expect(harnessLink(undefined)).toBe('connecting')
  expect(harnessLink(true)).toBe('ready')
  expect(harnessLink(false)).toBe('unreachable')
})

test('a read that gave up is unreachable, not a spinner that never stops', () => {
  expect(harnessLink(undefined, true)).toBe('unreachable')
  // an answer beats the failure of a LATER read — the harness is known either way
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
  live.setRun(run({ id: 'run-tools', chatId: 'tools', events: [] }))
  live.putEvent('tools', 'run-tools', tool(1, 'in_progress'))
  live.putEvent('tools', 'run-tools', {
    id: 'note',
    ts: '2026-09-01T10:00:02.000Z',
    kind: 'message',
    text: 'Running the suite.',
  })
  live.putEvent('tools', 'run-tools', tool(2, 'completed'))
  // a late copy of an older report must not undo the newer one
  live.putEvent('tools', 'run-tools', tool(1, 'in_progress'))

  const events = useAgentLive.getState().runs.tools!.events
  expect(events.map((event) => event.id)).toEqual(['call', 'note'])
  expect(events[0]).toMatchObject({ status: 'completed', revision: 2 })
})

test('two copies of a run keep the longer list, each step at its furthest revision', () => {
  // the stream saw a new event; the snapshot saw the call settle
  const streamed = [tool(1, 'in_progress'), { ...tool(1, 'in_progress'), id: 'next' }]
  const snapshot = [tool(2, 'completed')]

  const merged = mergeEvents(streamed, snapshot)
  expect(merged.map((event) => event.id)).toEqual(['call', 'next'])
  expect(merged[0]).toMatchObject({ status: 'completed', revision: 2 })
  // nothing newer on the other side: the very same list comes back
  expect(mergeEvents(snapshot, [tool(1, 'in_progress')])).toBe(snapshot)
  expect(
    reconcileRun(run({ events: streamed }), run({ events: snapshot }))?.events[0],
  ).toMatchObject({ revision: 2 })
})
