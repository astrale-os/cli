import type { AgentEvent, AgentRun } from '@shared/contracts/agent'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { activityLabel, compactTarget, latestNote, splitTurn, visibleDraft } from './agent-steps'
import { AgentTurn, agentAuthFailure } from './agent-turn'

const event = (kind: AgentEvent['kind'], text: string, extra?: Partial<AgentEvent>) =>
  ({ id: `${kind}-${text}`, ts: new Date(0).toISOString(), kind, text, ...extra }) as AgentEvent

const run = (events: AgentEvent[], patch: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run',
  chatId: 'chat',
  harness: 'claude',
  status: 'running',
  createdAt: new Date(0).toISOString(),
  summary: 'work',
  targetCommentIds: [],
  events,
  ...patch,
})

const done = (events: AgentEvent[]) =>
  run(events, { status: 'succeeded', finishedAt: new Date(90_000).toISOString() })

test('the activity line names the current tool, never prose already on screen', () => {
  const edit = event('tool', '', { tool: 'Edit', target: 'schema/billing/index.ts' })
  expect(activityLabel(run([event('thinking', 'Reading'), edit]))).toBe(
    'Edit · schema/billing/index.ts',
  )
  expect(
    activityLabel(run([event('tool', '', { tool: 'Read' }), event('message', 'Added it.')])),
  ).toBe('Read')
  expect(activityLabel(run([]))).toBe('Working…')
  expect(activityLabel(run([event('thinking', '')]))).toBe('Thinking…')
})

test('a long path keeps its tail, and compacting never invents a shortening', () => {
  const target = '/Users/dev/conductor/workspaces/cli-v1/manila/.context/fixture.ts'
  expect(activityLabel(run([event('tool', '', { tool: 'Read', target })]))).toBe(
    'Read · …/manila/.context/fixture.ts',
  )
  expect(compactTarget('schema/billing/index.ts')).toBe('schema/billing/index.ts')
  const flat = compactTarget(`${'a'.repeat(80)}END`)
  expect(flat.endsWith('END')).toBe(true)
  expect(flat.length).toBeLessThanOrEqual(44)
})

test('only the prose after the last tool is the answer; the narration before it is a step', () => {
  const { steps, answer } = splitTurn(
    done([
      event('message', 'I read the guides first.'),
      event('tool', 'Read', { tool: 'Read', target: 'schema/user.ts' }),
      event('thinking', 'the'),
      event('message', 'Now the schema.'),
      event('tool', 'pnpm test', { tool: 'execute', target: 'pnpm test', revision: 2 }),
      event('status', 'plan'),
      event('message', 'The Users page is in place.'),
    ]),
  )
  expect(answer.map((message) => message.text)).toEqual(['The Users page is in place.'])
  expect(steps.map((step) => step.kind)).toEqual(['note', 'tool', 'thinking', 'note', 'tool'])
  // a call the agent described keeps its own words; a bare one, the tool and its target
  expect(steps[1]).toEqual({
    kind: 'tool',
    id: 'tool-Read',
    tool: 'Read',
    detail: 'schema/user.ts',
  })
  expect(steps[4]).toMatchObject({ title: 'pnpm test', revision: 2 })
})

test('a turn that ends on a tool or an error still shows its last words; a running one none yet', () => {
  const failed = splitTurn({
    ...done([event('message', 'Writing the page.'), event('tool', 'Edit', { tool: 'Edit' })]),
    status: 'failed',
    error: 'boom',
  })
  expect(failed.answer.map((message) => message.text)).toEqual(['Writing the page.'])
  const running = splitTurn(
    run([event('tool', 'Read', { tool: 'Read' }), event('message', 'Now the schema.')]),
  )
  expect(running.answer).toEqual([])
  expect(latestNote(running.steps)).toBe('Now the schema.')
  expect(
    latestNote([{ kind: 'note', id: 'n', text: '\nI write the `User` **class**.\nMore.' }]),
  ).toBe('I write the User class.')
})

test('the message being written streams in, without the machine block it ends with', () => {
  const writing = {
    ...run([event('tool', 'Edit', { tool: 'Edit' })]),
    draft: { id: 'd1', text: 'Added the **field**.\n\n```json\n{ "schemaVersion": "x"' },
  }
  expect(visibleDraft(writing)).toBe('Added the **field**.')
  expect(visibleDraft({ ...writing, draft: { id: 'd1', text: 'Done.\n```json\n' } })).toBe('Done.')
  expect(
    visibleDraft({ ...writing, draft: { id: 'd1', text: 'Run:\n```sh\npnpm test\n```' } }),
  ).toContain('pnpm test')
  expect(
    visibleDraft({ ...writing, events: [event('message', 'x', { id: 'd1' })] }),
  ).toBeUndefined()
  expect(visibleDraft({ ...writing, status: 'succeeded' })).toBeUndefined()
})

test('an expired login becomes a recovery card instead of ACP internals', () => {
  const raw =
    'Internal error: Failed to authenticate: OAuth session expired: [session/query] sessionId=secret'
  expect(agentAuthFailure(run([], { status: 'failed', error: raw }))).toEqual({
    title: 'Your Claude Code session has expired',
    command: 'claude auth login',
  })
  expect(
    agentAuthFailure(
      run([], {
        harness: 'codex',
        status: 'failed',
        error: 'Authentication required: auth token is invalid',
      }),
    ),
  ).toEqual({ title: 'Your Codex session has expired', command: 'codex login' })
  expect(
    agentAuthFailure(run([], { status: 'failed', error: 'bridge error 401: denied' })),
  ).toBeUndefined()

  const html = renderToStaticMarkup(
    <AgentTurn run={run([], { status: 'failed', error: raw })} onContinue={() => {}} />,
  )
  expect(html).toContain('claude auth login')
  expect(html).not.toContain('sessionId=secret')
})

test('an interrupted or stopped turn offers one way forward, Continue, only when it can', () => {
  const interrupted = run([], {
    status: 'interrupted',
    error: 'the studio restarted during this turn',
  })
  const html = renderToStaticMarkup(<AgentTurn run={interrupted} onContinue={() => {}} />)
  expect(html).toContain('Studio restarted during this turn')
  expect(html).toContain('Continue')
  expect(html).not.toContain('Retry')

  const stopped = run([], { status: 'canceled' })
  expect(renderToStaticMarkup(<AgentTurn run={stopped} onContinue={() => {}} />)).toContain(
    'continue-turn',
  )
  const earlier = renderToStaticMarkup(<AgentTurn run={stopped} />)
  expect(earlier).toContain('You stopped this turn')
  expect(earlier).not.toContain('continue-turn')
})
