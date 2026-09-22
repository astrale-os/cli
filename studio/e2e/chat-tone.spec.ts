/**
 * A tab's colour is how you tell two conversations with the same agent apart,
 * so it has to belong to the conversation: closing another tab must not hand
 * the survivors someone else's colour.
 */
import type { ChatInfo } from '../shared/types'

import { dockWorkspacePanel, expect, test, type Page } from './test'

const markColour = (page: Page, title: string) =>
  page
    .getByRole('button', { name: title, exact: true })
    .locator('svg')
    .first()
    .evaluate((mark) => getComputedStyle(mark).color)

test('closing a chat never re-colours the others', async ({ page, request }) => {
  await dockWorkspacePanel(request, 'left')
  const titles = ['Tone orders', 'Tone billing', 'Tone search']
  const opened: ChatInfo[] = []
  for (const title of titles) {
    const response = await request.post('/api/agent/chats', {
      data: { action: 'open', harness: 'claude', title },
    })
    opened.push((await response.json()) as ChatInfo)
  }

  try {
    await page.goto('/')
    const before = await Promise.all(titles.map((title) => markColour(page, title)))
    // same agent, three conversations, three colours
    expect(new Set(before).size).toBe(3)

    await page.getByRole('button', { name: 'Tone billing', exact: true }).click()
    await page.getByRole('button', { name: 'Close Tone billing' }).click()
    await expect(page.getByRole('button', { name: 'Tone billing', exact: true })).toHaveCount(0)

    expect(await markColour(page, 'Tone orders')).toBe(before[0]!)
    expect(await markColour(page, 'Tone search')).toBe(before[2]!)

    // and it still holds after a reload, from what the server stored
    await page.reload()
    expect(await markColour(page, 'Tone search')).toBe(before[2]!)
  } finally {
    for (const chat of opened)
      await request.post('/api/agent/chats', { data: { action: 'close', chatId: chat.id } })
  }
})
