import type { AgentEvent, AgentRun } from '@shared/contracts/agent'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { errorDiagnostic, errorHeadline, trailingActivity } from './agent-error'
import { AgentTurn } from './agent-turn'

const event = (kind: AgentEvent['kind'], text: string, extra?: Partial<AgentEvent>) =>
  ({ id: `${kind}-${text}`, ts: new Date(0).toISOString(), kind, text, ...extra }) as AgentEvent

const failed = (error: string, events: AgentEvent[] = []): AgentRun => ({
  id: 'run-1',
  chatId: 'chat-1',
  harness: 'codex',
  status: 'failed',
  createdAt: new Date(0).toISOString(),
  finishedAt: new Date(4200).toISOString(),
  summary: 'work',
  instruction: 'Add a Refund class',
  targetCommentIds: [],
  events,
  error,
})

test('the headline is the first meaningful line, past transport wrappers', () => {
  expect(
    errorHeadline('Internal error: rate limit exceeded (JSON-RPC -32603)\n{"retryAfter":30}'),
  ).toBe('Rate limit exceeded')
  expect(errorHeadline('codex ACP agent exited 1\n\nstderr (tail):\npanic at main.rs')).toBe(
    'Codex ACP agent exited 1',
  )
  expect(errorHeadline('\n\n  Error: Error: boom')).toBe('Boom')
  expect(
    errorHeadline(
      'Internal error: API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    ),
  ).toBe('API Error: 529 · Overloaded')
  expect(errorHeadline('x'.repeat(400)).length).toBeLessThanOrEqual(140)
})

test('the conversation shows a compact chip, never the raw dump, and keeps real prose', () => {
  const raw =
    'Internal error (JSON-RPC -32603)\n{"details":"model overloaded"}\n\nstderr (tail):\nsecret-stack-trace'
  const html = renderToStaticMarkup(
    <AgentTurn
      run={failed(raw, [event('message', 'Added the Refund class to schema/billing.ts.')])}
      onContinue={() => {}}
    />,
  )
  expect(html).toContain('agent-error-chip')
  expect(html).toContain('Continue')
  expect(html).toContain('Added the Refund class')
  expect(html).not.toContain('Retry')
  expect(html).not.toContain('secret-stack-trace')
})

test('the diagnostic carries everything needed to investigate', () => {
  const run = failed('Internal error (JSON-RPC -32603)\n{"details":"model overloaded"}', [
    event('message', 'Looking at the schema.'),
    event('tool', '', { tool: 'Edit', target: 'schema/billing.ts' }),
    event('error', 'Internal error (JSON-RPC -32603)\n{"details":"model overloaded"}'),
    event('error', 'reply not merged'),
  ])
  const report = errorDiagnostic(run)
  for (const fact of [
    'Agent: codex',
    'Duration: 4.2 s',
    'Turn: run-1',
    'model overloaded',
    'tool: Edit · schema/billing.ts',
    'Add a Refund class',
  ])
    expect(report).toContain(fact)
  // prose is already on screen; the activity trail is the steps, minus the failure itself
  expect(trailingActivity(run).map((e) => e.text)).toEqual(['', 'reply not merged'])
})
