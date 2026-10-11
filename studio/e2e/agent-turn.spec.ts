/**
 * A turn as the reader follows it: the work behind it unfolds on demand, a reply
 * waits on the closed bar until it is read, and a failure reads once and asks for
 * attention. The agent is stood in for at the snapshot the client polls; the
 * page clock runs its five-second fallback poll without waiting it out.
 */
import type { AgentEvent, AgentRun, AgentToolCall } from '../shared/types'

import { dockWorkspacePanel, expect, stubAgent, test, type Page } from './test'

const at = new Date().toISOString()
const step = (id: string, kind: AgentEvent['kind'], text: string, extra?: Partial<AgentEvent>) =>
  ({ id, ts: at, kind, text, ...extra }) as AgentEvent

/** A running turn the test settles with `finish`. */
async function turn(page: Page, events: AgentEvent[] = []) {
  await page.clock.install()
  let current: AgentRun = {
    id: 'turn',
    chatId: 'turn-chat',
    harness: 'claude',
    status: 'running',
    createdAt: at,
    summary: 'Add users',
    instruction: 'Add a Users page',
    targetCommentIds: [],
    events,
  }
  await stubAgent(page, { run: () => current })
  return {
    finish: async (patch: Partial<AgentRun>) => {
      current = {
        ...current,
        finishedAt: new Date(Date.parse(at) + 90_000).toISOString(),
        ...patch,
      }
      await page.clock.runFor(5_000)
    },
  }
}

const REPLY = 'The schema update is ready.'
const replied: Partial<AgentRun> = {
  status: 'succeeded',
  events: [step('reply', 'message', REPLY)],
}

test('a reply stays flagged on the closed bar until that conversation is read', async ({
  page,
}) => {
  const agent = await turn(page)
  await page.goto('/')
  const dock = page.getByTestId('agent-dock')
  await expect(dock).toHaveAttribute('aria-busy', 'true')
  await agent.finish(replied)
  const notice = page.getByRole('button', { name: 'Read unread agent reply' })
  await expect(notice).toBeVisible({ timeout: 12_000 })
  await expect(dock).toHaveAttribute('data-agent-notification', 'unread')
  await expect(dock).not.toHaveAttribute('aria-busy', 'true')
  await page.reload()
  await expect(notice).toBeVisible()
  // reading comments does not read the agent's conversation
  await page.getByRole('button', { name: 'Open comments' }).click()
  await page.getByRole('button', { name: 'Close the chat' }).click()
  await expect(notice).toBeVisible()
  await notice.click()
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close the chat' }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(dock).toBeVisible()
  await expect(notice).toHaveCount(0)
})

test('a reply delivered while its transcript is visible leaves nothing unread', async ({
  page,
  request,
}) => {
  const agent = await turn(page)
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Collapse the panel' })).toBeVisible()
  await agent.finish(replied)
  await expect(page.getByText(REPLY, { exact: true })).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: 'Collapse the panel' }).click()
  await expect(page.getByTestId('agent-unread')).toHaveCount(0)
})

test('a failure flags the closed bar, and reads once in its notice', async ({ page }) => {
  const LIMIT = "You've hit your session limit · resets 6:40pm (Europe/Paris)"
  const agent = await turn(page)
  await page.goto('/')
  await expect(page.getByTestId('agent-dock')).toHaveAttribute('aria-busy', 'true')
  // the agent also said it as a message: the notice is the one place it reads
  await agent.finish({
    status: 'failed',
    events: [step('limit', 'message', LIMIT)],
    error: `Internal error: ${LIMIT}`,
  })
  const attention = page.getByRole('button', { name: 'Read agent error' })
  await expect(attention).toBeVisible({ timeout: 12_000 })
  await expect(page.getByTestId('agent-dock')).toHaveAttribute('data-agent-notification', 'error')

  await attention.click()
  const notice = page.getByTestId('stopped-turn')
  await expect(notice).toContainText(LIMIT)
  await expect(page.getByText('hit your session limit')).toHaveCount(1)
  await expect(page.getByTestId('continue-turn')).toBeVisible()
})

const work = [
  step('n1', 'message', 'I read the guides before touching the schema.'),
  step('t1', 'tool', 'Read', { tool: 'Read', target: 'schema/user.ts' }),
  step('th1', 'thinking', 'weighing'),
  step('th2', 'thinking', 'the roles'),
  step('n2', 'message', 'I write the `User` class now.'),
  step('t2', 'tool', 'Edit', { tool: 'Edit', target: 'schema/user.ts' }),
]

test('the work behind a turn unfolds on demand, while it runs and once it is done', async ({
  page,
  request,
}) => {
  const agent = await turn(page, work)
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')

  // running: one line, carrying the latest narration in place of the current tool
  const line = page.getByRole('button', { name: /I write the User class now/ })
  await expect(line).toBeVisible({ timeout: 12_000 })
  await expect(line).not.toContainText('Edit · schema/user.ts')
  await expect(line).toContainText('2 actions')
  const steps = page.getByTestId('agent-steps')
  await expect(steps).toHaveCount(0)

  await line.click()
  await expect(steps).toContainText('I read the guides before touching the schema.')
  await expect(steps).toContainText('Read')
  // thinking fragments collapse into a single line
  await expect(steps.getByText('Thinking', { exact: true })).toHaveCount(1)
  await line.click()
  await expect(steps).toHaveCount(0)

  // opened while it ran, it stays open when the turn ends
  await line.click()
  await agent.finish({
    status: 'succeeded',
    events: [...work, step('a1', 'message', 'The Users page is in place.')],
  })
  const answer = page.getByText('The Users page is in place.', { exact: true })
  await expect(answer).toBeVisible({ timeout: 12_000 })
  const summary = page.getByRole('button', { name: /2 actions/ })
  await expect(summary).toContainText('1m 30s')
  await expect(summary).toHaveAttribute('aria-expanded', 'true')

  // folded, the narration leaves the conversation: only the answer remains
  await summary.click()
  await expect(steps).toHaveCount(0)
  await expect(page.getByText('I read the guides before touching the schema.')).toHaveCount(0)
  await expect(answer).toBeVisible()
})

test('a tool call opens onto what it was given and what came back, and follows it as it runs', async ({
  page,
  request,
}) => {
  const command = (status: 'in_progress' | 'completed', revision: number) =>
    step('t3', 'tool', 'pnpm test', { tool: 'execute', target: 'pnpm test', status, revision })
  let settled = false
  const agent = await turn(page, [
    step('n3', 'message', 'I run the tests.'),
    command('in_progress', 1),
  ])
  await page.route('**/api/agent/tool-call**', (route) =>
    route.fulfill({
      json: {
        title: 'pnpm test',
        kind: 'execute',
        status: settled ? 'completed' : 'in_progress',
        input: { command: 'pnpm test', description: 'Run the suite' },
        content: settled ? [{ type: 'text', text: '```console\n12 pass\n```' }] : [],
        locations: [],
      } satisfies AgentToolCall,
    }),
  )
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')

  await page.getByRole('button', { name: /I run the tests/ }).click({ timeout: 12_000 })
  // the call reads in the agent's own words, and opens in place
  const call = page.getByRole('button', { name: 'pnpm test', exact: true })
  await expect(call).toHaveAttribute('aria-expanded', 'false')
  await call.click()
  const details = page.getByTestId('tool-call-details')
  await expect(details).toContainText('Run the suite')
  await expect(details).toContainText('Waiting for the result…')

  // it settles while open: the same step, now with its output
  settled = true
  await agent.finish({
    status: 'succeeded',
    events: [
      step('n3', 'message', 'I run the tests.'),
      command('completed', 2),
      step('a3', 'message', 'All green.'),
    ],
  })
  await expect(page.getByText('All green.', { exact: true })).toBeVisible({ timeout: 12_000 })
  await expect(details).toContainText('12 pass')
  await expect(details).not.toContainText('```')
  await expect(call).toHaveCount(1)
  await expect(call).toHaveAttribute('aria-expanded', 'true')
})
