import { expect, test } from 'bun:test'

import type { AgentEvent, AgentRun } from '../../shared/types'

import { handoffPreamble, summarizeChatTranscript } from './transfer'

function event(kind: AgentEvent['kind'], text: string, target?: string): AgentEvent {
  return {
    id: `${kind}-${text}`,
    ts: '2026-08-20T00:00:00.000Z',
    kind,
    text,
    ...(target === undefined ? {} : { target, tool: 'Edit' }),
  }
}

function run(extra: Partial<AgentRun>): AgentRun {
  return {
    id: crypto.randomUUID(),
    domainId: 'billing',
    chatId: 'chat-1',
    harness: 'claude',
    status: 'succeeded',
    createdAt: '2026-08-20T00:00:00.000Z',
    summary: 'a turn',
    targetCommentIds: [],
    events: [],
    ...extra,
  }
}

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
        events: [event('message', 'Started the workflow but could not finish.')],
      }),
    ],
  })

  expect(summary).toContain('Handoff from the claude conversation')
  expect(summary).toContain('Billing rework')
  expect(summary).toContain('Add a Subscription class')
  expect(summary).toContain('Added Subscription with a renewal date.')
  expect(summary).toContain('Now wire the renewal workflow')
  expect(summary).toContain('the harness lost its connection')
  expect(summary).toContain('schema/billing/subscription.ts')
  // the next agent must not think it can pick the old session back up
  expect(summary).toContain('cannot be resumed')
})

test('names a turn started from threads even when nothing was typed', () => {
  const summary = summarizeChatTranscript({
    fromHarness: 'codex',
    runs: [run({ targetCommentIds: ['c1', 'c2'], events: [event('message', 'Replied to both.')] })],
  })
  expect(summary).toContain('answer 2 open comment thread(s)')
})

test('an untouched chat has nothing to hand over', () => {
  expect(summarizeChatTranscript({ fromHarness: 'claude', runs: [] })).toBe('')
  expect(summarizeChatTranscript({ fromHarness: 'claude', runs: [run({})] })).toBe('')
})

test('keeps only the recent turns and says how many it dropped', () => {
  const many = Array.from({ length: 15 }, (_, index) =>
    run({ instruction: `turn ${index + 1}`, events: [event('message', `did ${index + 1}`)] }),
  )
  const summary = summarizeChatTranscript({ fromHarness: 'claude', runs: many })

  expect(summary).toContain('3 earlier turn(s) omitted')
  expect(summary).not.toContain('turn 3')
  expect(summary).toContain('turn 15')
  // numbering stays absolute, so "Turn 15" means the fifteenth of the conversation
  expect(summary).toContain('### Turn 15')
})

test('clamps a long instruction instead of replaying the whole thing', () => {
  const summary = summarizeChatTranscript({
    fromHarness: 'claude',
    runs: [run({ instruction: 'x'.repeat(2000), events: [event('message', 'ok')] })],
  })
  expect(summary).toContain('…')
  expect(summary.length).toBeLessThan(1500)
})

test('the preamble frames the briefing as context, not as the turn', () => {
  const framed = handoffPreamble('## Handoff\n\nsome context')
  expect(framed).toContain('Transferred conversation')
  expect(framed).toContain('some context')
  expect(framed.trimEnd().endsWith('---')).toBe(true)
})
