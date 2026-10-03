/**
 * Chat tabs are the user's to arrange and name: a tab dragged along the strip
 * stays where it was dropped (for the server too, so a reload keeps it), and any
 * tab can be renamed, not only the open one.
 */
import type { ChatInfo, ChatList } from '../shared/types'

import { dockWorkspacePanel, expect, test, type Page } from './test'

const TITLES = ['Arrange orders', 'Arrange billing', 'Arrange search']

const tab = (page: Page, title: string) => page.getByRole('button', { name: title, exact: true })

/** Our tabs in the order the strip shows them; other chats on the machine are ignored. */
const shown = (page: Page) =>
  page
    .locator('[data-chat-tab]')
    .evaluateAll(
      (tabs, titles) =>
        tabs.map((tab) => tab.getAttribute('aria-label')).filter((name) => titles.includes(name!)),
      TITLES,
    )

const stored = async (request: import('@playwright/test').APIRequestContext) => {
  const list = (await (await request.get('/api/agent/chats')).json()) as ChatList
  return list.chats.map((chat) => chat.title).filter((title) => TITLES.includes(title))
}

const reordered = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/agent/chats') &&
      response.request().postDataJSON()?.action === 'reorder',
    // agent routes wait on the harness probe, so the first one can take a while
    { timeout: 30_000 },
  )

test('a dragged tab stays where it was dropped, and moves with the keyboard', async ({
  page,
  request,
}) => {
  await dockWorkspacePanel(request, 'left')
  const opened: ChatInfo[] = []
  for (const title of TITLES) {
    const response = await request.post('/api/agent/chats', {
      data: { action: 'open', harness: 'claude', title },
    })
    opened.push((await response.json()) as ChatInfo)
  }

  try {
    await page.goto('/')
    await expect.poll(() => shown(page)).toEqual(TITLES)

    // drop the last tab on the first one's leading half: it lands before it
    const landed = reordered(page)
    await tab(page, 'Arrange search').dragTo(tab(page, 'Arrange orders'), {
      targetPosition: { x: 2, y: 8 },
    })
    await landed
    const dragged = ['Arrange search', 'Arrange orders', 'Arrange billing']
    await expect.poll(() => shown(page)).toEqual(dragged)
    expect(await stored(request)).toEqual(dragged)

    await page.reload()
    await expect.poll(() => shown(page)).toEqual(dragged)

    // Alt+→ steps a focused tab one place along, and it keeps the focus
    const stepped = reordered(page)
    await tab(page, 'Arrange orders').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await stepped
    const moved = ['Arrange search', 'Arrange billing', 'Arrange orders']
    await expect.poll(() => shown(page)).toEqual(moved)
    expect(await stored(request)).toEqual(moved)
    await expect(tab(page, 'Arrange orders')).toBeFocused()
  } finally {
    for (const chat of opened)
      await request.post('/api/agent/chats', { data: { action: 'close', chatId: chat.id } })
  }
})

test('any tab can be renamed, not only the open one', async ({ page, request }) => {
  await dockWorkspacePanel(request, 'left')
  const opened: ChatInfo[] = []
  for (const title of TITLES.slice(0, 2)) {
    const response = await request.post('/api/agent/chats', {
      data: { action: 'open', harness: 'claude', title },
    })
    opened.push((await response.json()) as ChatInfo)
  }

  try {
    await page.goto('/')
    // the last one opened is the open tab; rename the other one
    await expect(tab(page, 'Arrange orders')).toBeVisible({ timeout: 30_000 })
    await tab(page, 'Arrange orders').dblclick()
    const field = page.getByRole('textbox', { name: 'Chat name' })
    await expect(field).toBeVisible()
    await field.fill('Renamed orders')
    await field.press('Enter')
    // agent routes wait on the harness probe, so the rename can take a while to land
    await expect(tab(page, 'Renamed orders')).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(
        async () => {
          const list = (await (await request.get('/api/agent/chats')).json()) as ChatList
          return list.chats.find((chat) => chat.id === opened[0]!.id)?.title
        },
        { timeout: 30_000 },
      )
      .toBe('Renamed orders')

    // F2 opens the title of the focused tab too
    await tab(page, 'Arrange billing').focus()
    await page.keyboard.press('F2')
    await expect(page.getByRole('textbox', { name: 'Chat name' })).toHaveValue('Arrange billing')
    await page.keyboard.press('Escape')
  } finally {
    for (const chat of opened)
      await request.post('/api/agent/chats', { data: { action: 'close', chatId: chat.id } })
  }
})
