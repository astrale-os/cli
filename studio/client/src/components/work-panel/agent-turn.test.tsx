import type { AgentEvent, AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { latestNote, splitTurn } from './agent-steps'
import { activityLabel, AgentTurn, agentAuthFailure, compactTarget } from './agent-turn'

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

test('turns raw Claude and Codex authentication failures into actionable login guidance', () => {
  expect(
    agentAuthFailure({
      ...run([]),
      status: 'failed',
      error:
        'Internal error: Failed to authenticate: OAuth session expired and could not be refreshed',
    }),
  ).toEqual({ title: 'Your Claude Code session has expired', command: 'claude auth login' })

  expect(
    agentAuthFailure({
      ...run([]),
      harness: 'codex',
      status: 'failed',
      error: 'Authentication required: auth token is invalid',
    }),
  ).toEqual({ title: 'Your Codex session has expired', command: 'codex login' })
})

test('unrelated agent and tool failures retain their original diagnostics', () => {
  expect(
    agentAuthFailure({ ...run([]), status: 'failed', error: 'bridge error 401: denied' }),
  ).toBe(undefined)
  expect(agentAuthFailure({ ...run([]), status: 'failed', error: 'session not found' })).toBe(
    undefined,
  )
})

test('an expired login renders a clean recovery card instead of ACP internals', () => {
  const raw =
    'Internal error: Failed to authenticate: OAuth session expired: [session/query] sessionId=secret'
  const html = renderToStaticMarkup(
    <AgentTurn run={{ ...run([]), status: 'failed', error: raw }} onRetry={() => {}} />,
  )

  expect(html).toContain('Your Claude Code session has expired')
  expect(html).toContain('claude auth login')
  expect(html).toContain('I’ve signed in — retry')
  expect(html).not.toContain('sessionId=secret')
  expect(html).not.toContain('Internal error')
})

const done = (events: AgentEvent[]): AgentRun => ({
  ...run(events),
  status: 'succeeded',
  finishedAt: new Date(90_000).toISOString(),
})

test('only the prose after the last tool is the answer; the narration before it is a step', () => {
  const { steps, answer } = splitTurn(
    done([
      event('message', 'I read the guides first.'),
      event('tool', 'Read', { tool: 'Read', target: 'schema/user.ts' }),
      event('thinking', 'the'),
      event('thinking', 'schema'),
      event('message', 'Now the schema.'),
      event('tool', 'Edit', { tool: 'Edit', target: 'schema/user.ts' }),
      event('status', 'plan'),
      event('message', 'The Users page is in place.'),
    ]),
  )

  expect(answer.map((message) => message.text)).toEqual(['The Users page is in place.'])
  expect(steps.map((step) => step.kind)).toEqual(['note', 'tool', 'thinking', 'note', 'tool'])
})

test('a turn that ends on a tool, an error or a stop still shows the last thing it said', () => {
  const { steps, answer } = splitTurn({
    ...done([event('message', 'Writing the page.'), event('tool', 'Edit', { tool: 'Edit' })]),
    status: 'failed',
    error: 'boom',
  })

  expect(answer.map((message) => message.text)).toEqual(['Writing the page.'])
  expect(steps.map((step) => step.kind)).toEqual(['tool'])
})

test('nothing is final while the turn runs: the next event may be another tool', () => {
  const { steps, answer } = splitTurn(
    run([event('tool', 'Read', { tool: 'Read' }), event('message', 'Now the schema.')]),
  )

  expect(answer).toEqual([])
  expect(latestNote(steps)).toBe('Now the schema.')
})

test('the header carries the latest narration on one line, without markdown marks', () => {
  expect(
    latestNote([{ kind: 'note', id: 'n', text: '\nI write the `User` **class**.\nMore.' }]),
  ).toBe('I write the User class.')
  expect(latestNote([{ kind: 'thinking', id: 't' }])).toBe(undefined)
})

test('a running turn folds its work into one line naming what it does now', () => {
  const html = renderToStaticMarkup(
    <AgentTurn
      run={run([
        event('message', 'I write the User class.'),
        event('tool', 'Edit', { tool: 'Edit', target: 'schema/user.ts' }),
      ])}
    />,
  )

  expect(html).toContain('I write the User class.')
  expect(html).toContain('Edit · schema/user.ts')
  expect(html).toContain('aria-expanded="false"')
  // folded: the step list is not rendered until asked for
  expect(html).not.toContain('data-testid="agent-steps"')
})

test('a finished turn shows its answer under a folded count of the steps behind it', () => {
  const html = renderToStaticMarkup(
    <AgentTurn
      run={done([
        event('message', 'I read the guides first.'),
        event('tool', 'Read', { tool: 'Read' }),
        event('tool', 'Edit', { tool: 'Edit' }),
        event('message', 'The Users page is in place.'),
      ])}
    />,
  )

  expect(html).toContain('The Users page is in place.')
  expect(html).toContain('2 steps')
  expect(html).toContain('1m 30s')
  expect(html).not.toContain('I read the guides first.')
})

test('a finished turn without any work shows no step line', () => {
  const html = renderToStaticMarkup(<AgentTurn run={done([event('message', 'Hello.')])} />)

  expect(html).toContain('Hello.')
  expect(html).not.toContain('aria-expanded')
})
