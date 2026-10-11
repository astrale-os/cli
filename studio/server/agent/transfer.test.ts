import { expect, test } from 'bun:test'

import type { AgentEvent, AgentRun } from '../../shared/contracts/agent'

import { summarizeChatTranscript } from './transfer'

const at = '2026-08-20T00:00:00.000Z'
const event = (kind: AgentEvent['kind'], text: string, target?: string): AgentEvent => ({
  id: `${kind}-${text}`,
  ts: at,
  kind,
  text,
  ...(target === undefined ? {} : { target, tool: 'Edit' }),
})
const run = (extra: Partial<AgentRun>): AgentRun => ({
  id: crypto.randomUUID(),
  chatId: 'chat-1',
  harness: 'claude',
  status: 'succeeded',
  createdAt: at,
  summary: 'a turn',
  targetCommentIds: [],
  events: [],
  ...extra,
})

test('summarizes what was asked, what was answered and what was touched', () => {
  const summary = summarizeChatTranscript({
    fromHarness: 'claude',
    title: 'Billing rework',
    runs: [
      run({
        instruction: 'Add a Subscription class',
        events: [
          event('tool', 'editing', 'schema/billing/subscription.ts'),
          event('message', 'Added Subscription with a renewal date.'),
        ],
      }),
      run({
        instruction: 'Now wire the renewal workflow',
        status: 'failed',
        error: 'the harness lost its connection',
      }),
    ],
  })
  for (const part of [
    'Billing rework',
    'Add a Subscription class',
    'Added Subscription with a renewal date.',
    'Now wire the renewal workflow',
    'the harness lost its connection',
    'schema/billing/subscription.ts',
  ])
    expect(summary).toContain(part)
  // the next agent must not think it can pick the old session back up
  expect(summary).toContain('cannot be resumed')
  // an untouched chat has nothing to hand over
  expect(summarizeChatTranscript({ fromHarness: 'claude', runs: [run({})] })).toBe('')
})

test('the summary is bounded: recent turns only, long instructions clamped', () => {
  const many = Array.from({ length: 15 }, (_, index) =>
    run({ instruction: `turn ${index + 1}`, events: [event('message', `did ${index + 1}`)] }),
  )
  const recent = summarizeChatTranscript({ fromHarness: 'claude', runs: many })
  expect(recent).toContain('3 earlier turn(s) omitted')
  expect(recent).not.toContain('turn 3')
  // numbering stays absolute, so "Turn 15" means the fifteenth of the conversation
  expect(recent).toContain('### Turn 15')

  const long = summarizeChatTranscript({
    fromHarness: 'claude',
    runs: [run({ instruction: 'x'.repeat(2000), events: [event('message', 'ok')] })],
  })
  expect(long.length).toBeLessThan(1500)
})
