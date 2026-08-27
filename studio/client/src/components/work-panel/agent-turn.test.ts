import type { AgentEvent, AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import { activityLabel } from './agent-turn'

const event = (
  kind: AgentEvent['kind'],
  text: string,
  extra?: Partial<AgentEvent>,
): AgentEvent => ({
  id: `${kind}-${text}`,
  ts: new Date(0).toISOString(),
  kind,
  text,
  ...extra,
})

const run = (events: AgentEvent[]): AgentRun => ({
  id: 'run',
  domainId: 'crm',
  harness: 'claude',
  status: 'running',
  createdAt: new Date(0).toISOString(),
  summary: 'work',
  targetCommentIds: [],
  events,
})

test('the activity line names the current tool, not the whole log', () => {
  const label = activityLabel(
    run([
      event('thinking', 'Reading the schema'),
      event('tool', '', { tool: 'Edit', target: 'schema/billing/index.ts' }),
    ]),
  )

  expect(label).toBe('Edit · schema/billing/index.ts')
})

test('prose already on screen never becomes the activity line', () => {
  const label = activityLabel(
    run([event('tool', '', { tool: 'Read' }), event('message', 'Added the Refund class.')]),
  )

  // the message is rendered above; the line below it must still say what is happening
  expect(label).toBe('Read')
})

test('a turn with nothing reported yet still says something', () => {
  expect(activityLabel(run([]))).toBe('Working…')
  expect(activityLabel(run([event('thinking', '')]))).toBe('Thinking…')
})
