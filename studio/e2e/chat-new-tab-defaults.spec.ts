/**
 * A new tab continues the work in front of you: the model, the reasoning level
 * and the speed set on the current tab are what the next one opens with.
 */
import type { ChatInfo } from '../shared/types'

import { dockWorkspacePanel, expect, test } from './test'

test('a new tab keeps the current tab model, effort and speed', async ({ page, request }) => {
  await dockWorkspacePanel(request, 'left')
  const opened: string[] = []
  const source = (await (
    await request.post('/api/agent/chats', {
      data: { action: 'open', harness: 'claude', title: 'Tuned tab' },
    })
  ).json()) as ChatInfo
  opened.push(source.id)
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
    await expect(page.getByRole('button', { name: 'Tuned tab', exact: true })).toBeVisible()

    // agent routes wait on the harness probe, so the open can take a while to land
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/agent/chats') &&
        response.request().postDataJSON()?.action === 'open',
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: 'New chat' }).first().click()
    const chat = (await (await created).json()) as ChatInfo
    opened.push(chat.id)

    expect(chat).toMatchObject({
      harness: 'claude',
      model: 'opus[1m]',
      effort: 'high',
      fastMode: true,
    })
    expect(chat.id).not.toBe(source.id)
  } finally {
    for (const chatId of opened)
      await request.post('/api/agent/chats', { data: { action: 'close', chatId } })
  }
})
