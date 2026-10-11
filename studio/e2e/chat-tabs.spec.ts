/**
 * Chat tabs belong to the user and to their conversation: a tab stays where it was
 * dropped and keeps the name and colour it was given, a new tab carries on with the
 * current one's settings, and what was written for one agent stays with it.
 */
import type { ChatInfo, ChatList } from '../shared/types'

import {
  chatAction,
  chatInfo,
  dockWorkspacePanel,
  expect,
  openChats,
  stubAgent,
  test,
  type Page,
} from './test'

const tab = (page: Page, title: string) => page.getByRole('button', { name: title, exact: true })

test('a tab is dragged, stepped with the keyboard and renamed, and the server keeps it', async ({
  page,
  request,
}) => {
  const titles = ['Arrange orders', 'Arrange billing', 'Arrange search']
  /** Our tabs in the order the strip shows them; other chats on the machine are ignored. */
  const shown = () =>
    page
      .locator('[data-chat-tab]')
      .evaluateAll(
        (tabs, ours) =>
          tabs.map((tab) => tab.getAttribute('aria-label')).filter((name) => ours.includes(name!)),
        titles,
      )
  const stored = async () => {
    const list = (await (await request.get('/api/agent/chats')).json()) as ChatList
    return list.chats.filter((chat) => titles.includes(chat.title) || chat.title === 'Renamed')
  }
  await dockWorkspacePanel(request, 'left')
  const chats = await openChats(request, titles)
  try {
    await page.goto('/')
    await expect.poll(shown).toEqual(titles)

    // drop the last tab on the first one's upper half: in the column it lands before it
    const landed = chatAction(page, 'reorder')
    await tab(page, 'Arrange search').dragTo(tab(page, 'Arrange orders'), {
      targetPosition: { x: 8, y: 2 },
    })
    await landed
    const dragged = ['Arrange search', 'Arrange orders', 'Arrange billing']
    await expect.poll(shown).toEqual(dragged)
    expect((await stored()).map((chat) => chat.title)).toEqual(dragged)
    await page.reload()
    await expect.poll(shown).toEqual(dragged)

    // Alt+↓ steps a focused tab one place down the column, and it keeps the focus
    const stepped = chatAction(page, 'reorder')
    await tab(page, 'Arrange orders').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await stepped
    await expect.poll(shown).toEqual(['Arrange search', 'Arrange billing', 'Arrange orders'])
    await expect(tab(page, 'Arrange orders')).toBeFocused()

    // any tab can be renamed, not only the open one: F2 on a focused tab, or a double click
    await page.keyboard.press('F2')
    await expect(page.getByRole('textbox', { name: 'Chat name' })).toHaveValue('Arrange orders')
    await page.keyboard.press('Escape')
    await tab(page, 'Arrange billing').dblclick()
    const field = page.getByRole('textbox', { name: 'Chat name' })
    await field.fill('Renamed')
    await field.press('Enter')
    await expect(tab(page, 'Renamed')).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => (await stored()).find((chat) => chat.id === chats.opened[1]!.id)?.title, {
        timeout: 30_000,
      })
      .toBe('Renamed')
  } finally {
    await chats.close()
  }
})

test('closing a chat never re-colours the others', async ({ page, request }) => {
  const markColour = (title: string) =>
    tab(page, title)
      .locator('svg')
      .first()
      .evaluate((mark) => getComputedStyle(mark).color)
  await dockWorkspacePanel(request, 'left')
  const chats = await openChats(request, ['Tone orders', 'Tone billing', 'Tone search'])
  try {
    await page.goto('/')
    const before = await Promise.all(chats.opened.map((chat) => markColour(chat.title)))
    // same agent, three conversations, three colours
    expect(new Set(before).size).toBe(3)

    await tab(page, 'Tone billing').click()
    const closed = chatAction(page, 'close')
    await page.getByRole('button', { name: 'Close Tone billing' }).click()
    await closed
    await expect(tab(page, 'Tone billing')).toHaveCount(0)
    expect(await markColour('Tone orders')).toBe(before[0]!)
    expect(await markColour('Tone search')).toBe(before[2]!)

    // and it still holds after a reload, from what the server stored
    await page.reload()
    expect(await markColour('Tone search')).toBe(before[2]!)
  } finally {
    await chats.close()
  }
})

test('the tab column runs the panel height and resizes; along the top, titles on request', async ({
  page,
  request,
}) => {
  await dockWorkspacePanel(request, 'left')
  const chats = await openChats(request, ['Layout orders', 'Layout billing'])
  try {
    await page.goto('/')
    const column = page.locator('nav[data-chat-tabs="left"]')
    await expect(column).toBeVisible({ timeout: 30_000 })
    // every tab carries its title in the column, not only the open one
    await expect(column.getByText('Layout orders')).toBeVisible()
    await expect(column.getByText('Layout billing')).toBeVisible()

    // down beside the composer, not stopping above it
    const columnBox = (await column.boundingBox())!
    const fieldBox = (await page.getByPlaceholder('Message the agent…').boundingBox())!
    expect(columnBox.y + columnBox.height).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height)
    expect(fieldBox.x).toBeGreaterThanOrEqual(columnBox.x + columnBox.width - 1)

    // drag the right edge: the column follows, and keeps that width after a reload
    const grip = (await page
      .getByRole('separator', { name: 'Resize the chat tabs' })
      .boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2 - 30, grip.y + grip.height / 2, { steps: 5 })
    await page.mouse.up()
    const width = async () => Math.round((await column.boundingBox())!.width)
    await expect.poll(width).toBe(Math.round(columnBox.width - 30))
    await page.reload()
    await expect.poll(width, { timeout: 30_000 }).toBe(Math.round(columnBox.width - 30))

    // along the top, marks only: the open tab names itself, the others do not
    await page.addInitScript(() => localStorage.setItem('studio.chatTabs', 'top'))
    await page.reload()
    await expect(tab(page, 'Layout orders')).toBeVisible({ timeout: 30_000 })
    await expect(column).toHaveCount(0)
    await expect(tab(page, 'Layout billing')).toContainText('Layout billing')
    await expect(tab(page, 'Layout orders')).not.toContainText('Layout orders')

    await page.addInitScript(() => localStorage.setItem('studio.chatTabs', 'top-titled'))
    await page.reload()
    await expect(tab(page, 'Layout orders')).toContainText('Layout orders', { timeout: 30_000 })
  } finally {
    await chats.close()
  }
})

test('a new tab keeps the current tab model, effort and speed', async ({ page, request }) => {
  await dockWorkspacePanel(request, 'left')
  const chats = await openChats(request, ['Tuned tab'])
  const source = chats.opened[0]!
  await request.post('/api/agent/chats', {
    data: {
      action: 'update',
      chatId: source.id,
      model: 'opus[1m]',
      effort: 'high',
      fastMode: true,
    },
  })
  try {
    await page.goto('/')
    await expect(tab(page, 'Tuned tab')).toBeVisible()
    const created = chatAction(page, 'open')
    await page.getByRole('button', { name: 'New chat' }).first().click()
    const chat = (await (await created).json()) as ChatInfo
    chats.opened.push(chat)
    expect(chat.id).not.toBe(source.id)
    expect(chat).toMatchObject({
      harness: 'claude',
      model: 'opus[1m]',
      effort: 'high',
      fastMode: true,
    })
  } finally {
    await chats.close()
  }
})

test('the composer carries a draft per chat, not one draft across them', async ({
  page,
  request,
}) => {
  await stubAgent(page, {
    chats: [chatInfo('chat-orders', 'Orders'), chatInfo('chat-billing', 'Billing')],
  })
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')

  const field = page.locator('[data-agent-composer]')
  await expect(field).toBeEnabled()
  await field.fill('rename the Order class')

  // the other agent is a different recipient: its field has never been written in
  await tab(page, 'Billing').click()
  await expect(field).toHaveValue('')
  await field.fill('write the billing tests')

  // back where it was written, exactly as it was left
  await tab(page, 'Orders').click()
  await expect(field).toHaveValue('rename the Order class')
  await tab(page, 'Billing').click()
  await expect(field).toHaveValue('write the billing tests')
})
