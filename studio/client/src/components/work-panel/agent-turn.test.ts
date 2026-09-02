import type { AgentEvent, AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'

import { activityLabel, compactTarget } from './agent-turn'

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
  chatId: 'chat',
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

test('a long path keeps its tail — CSS truncation would have cut exactly that off', () => {
  const label = activityLabel(
    run([
      event('tool', '', {
        tool: 'Read',
        target: '/Users/dev/conductor/workspaces/cli-v1/manila/.context/fixture.ts',
      }),
    ]),
  )

  expect(label).toBe('Read · …/manila/.context/fixture.ts')
})

test('compacting never invents a shortening it cannot afford', () => {
  // short enough to read whole — left alone
  expect(compactTarget('schema/billing/index.ts')).toBe('schema/billing/index.ts')
  // no separators to fold on: trimmed from the front, still ending on the real tail
  const flat = `${'a'.repeat(80)}END`
  expect(compactTarget(flat).endsWith('END')).toBe(true)
  expect(compactTarget(flat).length).toBeLessThanOrEqual(44)
})
