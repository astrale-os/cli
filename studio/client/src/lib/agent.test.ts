import type { AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import { isRunActive, reconcileRun } from './agent'

const run = (patch: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  domainId: 'd',
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
