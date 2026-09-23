import type { AgentEvent, AgentRun, ChatInfo } from '../shared/types'

import { dockWorkspacePanel, expect, test, type Page } from './test'

const at = new Date().toISOString()
const step = (id: string, kind: AgentEvent['kind'], text: string, extra?: Partial<AgentEvent>) => ({
  id,
  ts: at,
  kind,
  text,
  ...extra,
})

const work: AgentEvent[] = [
  step('n1', 'message', 'I read the guides before touching the schema.'),
  step('t1', 'tool', 'Read', { tool: 'Read', target: 'schema/user.ts' }),
  step('th1', 'thinking', 'weighing'),
  step('th2', 'thinking', 'the roles'),
  step('n2', 'message', 'I write the `User` class now.'),
  step('t2', 'tool', 'Edit', { tool: 'Edit', target: 'schema/user.ts' }),
]

async function agent(page: Page) {
  await page.clock.install()
  let current: AgentRun = {
    id: 'steps-turn',
    chatId: 'steps-chat',
    harness: 'claude',
    status: 'running',
    createdAt: at,
    summary: 'Add users',
    instruction: 'Add a Users page',
    targetCommentIds: [],
    events: work,
  }
  await page.route('**/api/agent**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/agent')
      return route.fulfill({
        json: {
          chatId: current.chatId,
          harness: 'claude',
          available: true,
          run: current,
          conversation: { turns: 1 },
        },
      })
    if (path === '/api/agent/history') return route.fulfill({ json: [current] })
    if (path === '/api/agent/chats') {
      const chat: ChatInfo = {
        id: current.chatId,
        title: 'Steps test',
        harness: 'claude',
        turns: 1,
        createdAt: at,
        updatedAt: at,
        status: current.status === 'running' ? 'running' : 'idle',
        queued: [],
      }
      return route.fulfill({ json: { activeId: chat.id, chats: [chat] } })
    }
    return route.continue()
  })
  return {
    complete: async () => {
      current = {
        ...current,
        status: 'succeeded',
        finishedAt: new Date(Date.parse(at) + 90_000).toISOString(),
        events: [...work, step('a1', 'message', 'The Users page is in place.')],
      }
      await page.clock.runFor(5_000)
    },
  }
}

test('the work behind a turn unfolds on demand, while it runs and once it is done', async ({
  page,
  request,
}) => {
  const stub = await agent(page)
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')

  // running: one line, carrying the latest narration and the current tool
  const line = page.getByRole('button', { name: /I write the User class now/ })
  await expect(line).toBeVisible({ timeout: 12_000 })
  await expect(line).toContainText('Edit · schema/user.ts')
  await expect(line).toHaveAttribute('aria-expanded', 'false')
  const steps = page.getByTestId('agent-steps')
  await expect(steps).toHaveCount(0)

  await line.click()
  await expect(steps).toBeVisible()
  await expect(steps).toContainText('I read the guides before touching the schema.')
  await expect(steps).toContainText('Read')
  // thinking fragments collapse into a single line
  await expect(steps.getByText('Thinking', { exact: true })).toHaveCount(1)

  await line.click()
  await expect(steps).toHaveCount(0)

  // opened while it ran, it stays open when the turn ends
  await line.click()
  await stub.complete()
  const answer = page.getByText('The Users page is in place.', { exact: true })
  await expect(answer).toBeVisible({ timeout: 12_000 })
  const summary = page.getByRole('button', { name: /2 steps/ })
  await expect(summary).toContainText('1m 30s')
  await expect(summary).toHaveAttribute('aria-expanded', 'true')
  await expect(steps).toContainText('I write the User class now.')

  // folded, the narration leaves the conversation: only the answer remains
  await summary.click()
  await expect(steps).toHaveCount(0)
  await expect(page.getByText('I read the guides before touching the schema.')).toHaveCount(0)
  await expect(answer).toBeVisible()
})
