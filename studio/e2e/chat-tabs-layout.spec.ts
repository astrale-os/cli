/**
 * By default the chat tabs are a column down the panel's whole left side, beside
 * the composer as well as the conversation, and its right edge resizes it. Along
 * the top, the strip shows the agents' marks alone, or every tab's title too.
 */
import type { ChatInfo } from '../shared/types'

import { dockWorkspacePanel, expect, test, type Page } from './test'

const TITLES = ['Layout orders', 'Layout billing']

const tab = (page: Page, title: string) => page.getByRole('button', { name: title, exact: true })

async function openChats(request: import('@playwright/test').APIRequestContext) {
  const opened: ChatInfo[] = []
  for (const title of TITLES) {
    const response = await request.post('/api/agent/chats', {
      data: { action: 'open', harness: 'claude', title },
    })
    opened.push((await response.json()) as ChatInfo)
  }
  return opened
}

test('the tab column runs the panel height and resizes from its edge', async ({
  page,
  request,
}) => {
  await dockWorkspacePanel(request, 'left')
  const opened = await openChats(request)

  try {
    await page.goto('/')
    const column = page.locator('nav[data-chat-tabs="left"]')
    await expect(column).toBeVisible({ timeout: 30_000 })
    // every tab carries its title in the column, not only the open one
    await expect(column.getByText('Layout orders')).toBeVisible()
    await expect(column.getByText('Layout billing')).toBeVisible()

    // down beside the composer, not stopping above it
    const field = page.getByPlaceholder('Message the agent…')
    const columnBox = (await column.boundingBox())!
    const fieldBox = (await field.boundingBox())!
    expect(columnBox.y + columnBox.height).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height)
    expect(fieldBox.x).toBeGreaterThanOrEqual(columnBox.x + columnBox.width - 1)

    // drag the right edge: the column follows, and keeps that width after a reload
    const grip = page.getByRole('separator', { name: 'Resize the chat tabs' })
    const gripBox = (await grip.boundingBox())!
    const x = gripBox.x + gripBox.width / 2
    const y = gripBox.y + gripBox.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 30, y, { steps: 5 })
    await page.mouse.up()
    await expect
      .poll(async () => Math.round((await column.boundingBox())!.width))
      .toBe(Math.round(columnBox.width - 30))

    await page.reload()
    await expect
      .poll(async () => Math.round((await column.boundingBox())!.width), { timeout: 30_000 })
      .toBe(Math.round(columnBox.width - 30))
  } finally {
    for (const chat of opened)
      await request.post('/api/agent/chats', { data: { action: 'close', chatId: chat.id } })
  }
})

test('along the top, titles are shown only when asked for', async ({ page, request }) => {
  await dockWorkspacePanel(request, 'left')
  const opened = await openChats(request)

  try {
    await page.addInitScript(() => localStorage.setItem('studio.chatTabs', 'top'))
    await page.goto('/')
    await expect(tab(page, 'Layout orders')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('nav[data-chat-tabs="left"]')).toHaveCount(0)
    // marks only: the open tab names itself, the others do not
    await expect(tab(page, 'Layout billing')).toContainText('Layout billing')
    await expect(tab(page, 'Layout orders')).not.toContainText('Layout orders')

    await page.addInitScript(() => localStorage.setItem('studio.chatTabs', 'top-titled'))
    await page.reload()
    await expect(tab(page, 'Layout orders')).toContainText('Layout orders', { timeout: 30_000 })
    await expect(tab(page, 'Layout billing')).toContainText('Layout billing')
  } finally {
    for (const chat of opened)
      await request.post('/api/agent/chats', { data: { action: 'close', chatId: chat.id } })
  }
})
