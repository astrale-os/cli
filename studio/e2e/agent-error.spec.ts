import type { AgentRun, ChatInfo } from '../shared/types'

import { dockWorkspacePanel, expect, test } from './test'

const LIMIT = "You've hit your session limit · resets 6:40pm (Europe/Paris)"

test('a failure the agent also said as a message reads once, in the failure notice', async ({
  page,
  request,
}) => {
  const createdAt = new Date().toISOString()
  const run: AgentRun = {
    id: 'limit-turn',
    chatId: 'limit-chat',
    harness: 'claude',
    status: 'failed',
    createdAt,
    finishedAt: createdAt,
    summary: 'Add a skeleton loader',
    instruction: 'Add a skeleton loader',
    targetCommentIds: [],
    events: [{ id: 'limit', kind: 'message', ts: createdAt, text: LIMIT }],
    error: `Internal error: ${LIMIT}`,
  }
  await page.route('**/api/agent**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/agent')
      return route.fulfill({
        json: {
          chatId: run.chatId,
          harness: 'claude',
          available: true,
          run,
          conversation: { turns: 1 },
        },
      })
    if (path === '/api/agent/history') return route.fulfill({ json: [run] })
    if (path === '/api/agent/chats') {
      const chat: ChatInfo = {
        id: run.chatId,
        title: 'Session limit',
        harness: 'claude',
        turns: 1,
        createdAt,
        updatedAt: createdAt,
        status: 'idle',
        queued: [],
      }
      return route.fulfill({ json: { activeId: chat.id, chats: [chat] } })
    }
    return route.continue()
  })
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')

  const notice = page.getByTestId('stopped-turn')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(LIMIT)
  await expect(page.getByText('hit your session limit')).toHaveCount(1)
  await expect(page.getByTestId('continue-turn')).toBeVisible()
})
