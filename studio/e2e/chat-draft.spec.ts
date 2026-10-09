/**
 * A message is written TO an agent. The composer is shared by every tab, so the
 * one thing it must not do is carry what you wrote for one agent over to the
 * next: switching tabs shows that tab's own message, and coming back brings
 * yours home untouched.
 */
import type { ChatInfo, ChatList } from '../shared/types'

import { dockWorkspacePanel, expect, test, type Page } from './test'

const AT = '2026-09-01T00:00:00.000Z'

const chat = (id: string, title: string): ChatInfo => ({
  id,
  title,
  harness: 'claude',
  turns: 0,
  createdAt: AT,
  updatedAt: AT,
  status: 'idle',
  queued: [],
})

/** Two chats on one agent, and a harness that answers — so the field is open. */
async function twoChats(page: Page) {
  const chats = [chat('chat-orders', 'Orders'), chat('chat-billing', 'Billing')]
  let activeId = chats[0]!.id
  const list = (): ChatList => ({ chats, activeId })

  await page.route('**/api/agent**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/agent/chats') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as { action?: string; chatId?: string }
        if (body.action === 'select' && body.chatId) activeId = body.chatId
        return route.fulfill({ json: list() })
      }
      return route.fulfill({ json: list() })
    }
    if (path === '/api/agent')
      return route.fulfill({
        json: {
          chatId: activeId,
          harness: 'claude',
          available: true,
          run: null,
          conversation: { active: false, turns: 0 },
        },
      })
    if (path === '/api/agent/history') return route.fulfill({ json: [] })
    return route.continue()
  })
}

test('the composer carries a draft per chat, not one draft across them', async ({
  page,
  request,
}) => {
  await twoChats(page)
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')

  const field = page.locator('[data-agent-composer]')
  await expect(field).toBeEnabled()

  await field.fill('rename the Order class')
  await expect(field).toHaveValue('rename the Order class')

  // the other agent is a different recipient: its field has never been written in
  await page.getByRole('button', { name: 'Billing' }).click()
  await expect(field).toHaveValue('')

  await field.fill('write the billing tests')
  await page.getByRole('button', { name: 'Orders' }).click()
  // back where it was written, exactly as it was left
  await expect(field).toHaveValue('rename the Order class')

  await page.getByRole('button', { name: 'Billing' }).click()
  await expect(field).toHaveValue('write the billing tests')
})
