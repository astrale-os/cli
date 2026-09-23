import type { AgentEvent, AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { errorDiagnostic, errorHeadline, trailingActivity } from './agent-error'
import { AgentTurn } from './agent-turn'

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

test('the conversation shows a compact chip, never the raw dump', () => {
  const raw =
    'Internal error (JSON-RPC -32603)\n{"details":"model overloaded"}\n\nstderr (tail):\nsecret-stack-trace'
  const html = renderToStaticMarkup(<AgentTurn run={failed(raw)} onRetry={() => {}} />)

  expect(html).toContain('agent-error-chip')
  expect(html).toContain('Failed')
  expect(html).toContain('Retry')
  expect(html).not.toContain('secret-stack-trace')
  expect(html).not.toContain('model overloaded')
})

test('the diagnostic carries everything needed to investigate', () => {
  const run = failed('Internal error (JSON-RPC -32603)\n{"details":"model overloaded"}', [
    event('message', 'Looking at the schema.'),
    event('tool', '', { tool: 'Edit', target: 'schema/billing.ts' }),
    event('error', 'Internal error (JSON-RPC -32603)\n{"details":"model overloaded"}'),
    event('error', 'reply not merged'),
  ])
  const report = errorDiagnostic(run)

  expect(report).toContain('Agent: codex')
  expect(report).toContain('Duration: 4.2 s')
  expect(report).toContain('Turn: run-1')
  expect(report).toContain('model overloaded')
  expect(report).toContain('tool: Edit · schema/billing.ts')
  expect(report).toContain('Add a Refund class')
  // prose is already on screen; the activity trail is the steps
  expect(trailingActivity(run).map((e) => e.kind)).toEqual(['tool', 'error'])
  expect(trailingActivity(run).at(-1)?.text).toBe('reply not merged')
})
