/**
 * An image is part of what you say to the agent: pasted into the composer it
 * waits there as a chip you can take back, leaves with the message, and stays
 * in the conversation beside it. The upload, the stored copy and its removal
 * are the real server's; only the agent itself is stood in for.
 */
import type { AgentRun, ChatAttachment } from '../shared/types'

import { dockWorkspacePanel, expect, test, type Locator } from './test'

/** Paste a freshly drawn PNG the way a screenshot tool leaves it on the clipboard. */
const pasteImage = (field: Locator, label: string) =>
  field.evaluate(async (element, text) => {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 140
    const context = canvas.getContext('2d')!
    context.fillStyle = '#c2410c'
    context.fillRect(0, 0, 240, 140)
    context.fillStyle = '#fff'
    context.fillText(text, 20, 70)
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    )
    const data = new DataTransfer()
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }))
    element.focus()
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, label)

test('a pasted image rides the message and stays in the conversation', async ({
  page,
  request,
}) => {
  const submitted: { message?: string; attachments?: string[] }[] = []
  const uploaded: ChatAttachment[] = []
  page.on('response', async (response) => {
    if (response.request().method() === 'POST' && response.url().includes('/api/agent/attachments'))
      uploaded.push((await response.json()) as ChatAttachment)
  })
  await page.route('**/api/agent**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/agent')
      return route.fulfill({
        json: { available: true, run: null, conversation: { active: false, turns: 0 } },
      })
    if (path === '/api/agent/submit') {
      const body = route.request().postDataJSON() as {
        chatId: string
        message?: string
        attachments?: string[]
      }
      submitted.push(body)
      const run: AgentRun = {
        id: 'run-with-image',
        chatId: body.chatId,
        harness: 'claude',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
        summary: body.message ?? '1 image',
        ...(body.message ? { instruction: body.message } : {}),
        attachments: uploaded.filter((image) => body.attachments?.includes(image.id)),
        targetCommentIds: [],
        events: [],
      }
      return route.fulfill({ json: { run } })
    }
    return route.continue()
  })
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')

  const field = page.locator('[data-agent-composer]')
  await expect(field).toBeEnabled()
  await pasteImage(field, 'first')
  await pasteImage(field, 'second')

  const chips = page.locator('[data-composer-images] img')
  await expect(chips).toHaveCount(2)
  // the image was the paste: nothing lands in the text
  await expect(field).toHaveValue('')
  await expect(page.getByRole('status', { name: /^Uploading/ })).toHaveCount(0)

  // taken back before sending: gone from the composer and from the server
  const removal = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.ok(),
  )
  await page
    .getByRole('button', { name: /^Remove / })
    .last()
    .click()
  await removal
  await expect(chips).toHaveCount(1)

  await field.fill('What is wrong on this screen?')
  await page.getByRole('button', { name: 'Send', exact: true }).click()

  await expect(chips).toHaveCount(0)
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toMatchObject({
    message: 'What is wrong on this screen?',
    attachments: [uploaded[0]!.id],
  })
  // shown in the conversation from the copy the server kept
  const shown = page.locator('[data-message-images] img')
  await expect(shown).toHaveCount(1)
  await expect.poll(() => shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(240)
})
