import type { AgentRun, ChatInfo } from '../shared/types'

import { dockWorkspacePanel, expect, test, type Page } from './test'

async function agent(page: Page) {
  const createdAt = new Date().toISOString()
  let current: AgentRun = {
    id: 'notification-turn',
    chatId: 'notification-chat',
    harness: 'claude',
    status: 'running',
    createdAt,
    summary: 'Update the schema',
    targetCommentIds: [],
    events: [],
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
        title: 'Notification test',
        harness: 'claude',
        turns: 1,
        createdAt,
        updatedAt: createdAt,
        status: current.status === 'running' ? 'running' : 'idle',
        queued: [],
      }
      return route.fulfill({ json: { activeId: chat.id, chats: [chat] } })
    }
    return route.continue()
  })
  return {
    complete: (status: 'succeeded' | 'failed' = 'succeeded') => {
      current = {
        ...current,
        status,
        finishedAt: new Date().toISOString(),
        events: [
          { id: 'reply', kind: 'message', ts: createdAt, text: 'The schema update is ready.' },
        ],
        ...(status === 'failed' ? { error: 'The agent could not finish.' } : {}),
      }
    },
  }
}

test('a completed reply stays visible on the closed bar until that conversation is read', async ({
  page,
}) => {
  const stub = await agent(page)
  await page.goto('/')
  const dock = page.getByTestId('agent-dock')
  await expect(dock).toHaveAttribute('aria-busy', 'true')
  stub.complete()
  const notice = page.getByRole('button', { name: 'Read unread agent reply' })
  await expect(notice).toBeVisible({ timeout: 12_000 })
  await expect(dock).toHaveAttribute('data-agent-notification', 'unread')
  await expect(dock).not.toHaveAttribute('aria-busy', 'true')
  expect((await dock.boundingBox())!.height).toBeLessThan(60)
  await page.reload()
  await expect(notice).toBeVisible()
  // Reading comments does not read the agent's conversation.
  await page.getByRole('button', { name: 'Open comments' }).click()
  await page.getByRole('button', { name: 'Close the chat' }).click()
  await expect(notice).toBeVisible()
  await notice.click()
  await expect(page.getByText('The schema update is ready.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close the chat' }).click()
  await expect(notice).toHaveCount(0)
  await page.reload()
  await expect(dock).toBeVisible()
  await expect(notice).toHaveCount(0)
})

test('a reply delivered while its transcript is visible does not leave an unread badge', async ({
  page,
  request,
}) => {
  const stub = await agent(page)
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Collapse the panel' })).toBeVisible()
  stub.complete()
  await expect(page.getByText('The schema update is ready.', { exact: true })).toBeVisible({
    timeout: 12_000,
  })
  await page.getByRole('button', { name: 'Collapse the panel' }).click()
  await expect(page.getByTestId('agent-unread')).toHaveCount(0)
})

test('an agent failure leaves an attention indicator on the closed bar', async ({ page }) => {
  const stub = await agent(page)
  await page.goto('/')
  await expect(page.getByTestId('agent-dock')).toHaveAttribute('aria-busy', 'true')
  stub.complete('failed')
  await expect(page.getByRole('button', { name: 'Read agent error' })).toBeVisible({
    timeout: 12_000,
  })
  await expect(page.getByTestId('agent-dock')).toHaveAttribute('data-agent-notification', 'error')
})
