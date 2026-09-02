import { expect, test } from './test'

test('Ask and comments keep the owning domain for a homonymous workspace node', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()
  // The rail's eye puts another workspace domain on the canvas.
  await page.getByRole('button', { name: 'Show ops.studio-demo.astrale.ai on the canvas' }).click()

  const peerNode = page.locator('.react-flow__node[data-id="workspace:peer:class.Company"]')
  await expect(peerNode).toBeVisible()
  await expect(page.getByTestId('workspace-domain-peer')).toBeVisible()

  await page.keyboard.press('a')
  await peerNode.click()
  const askDot = page.getByTitle('Ask', { exact: true })
  await expect(page.getByPlaceholder('Ask about Company…')).toBeVisible()
  await expect(askDot).toBeVisible()

  const alignedWithPeer = async () => {
    const node = await peerNode.boundingBox()
    const dot = await askDot.boundingBox()
    if (!node || !dot) return false
    const dotCenter = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 }
    return (
      Math.abs(dotCenter.x - (node.x + node.width - 10)) < 2 &&
      Math.abs(dotCenter.y - (node.y + 10)) < 2
    )
  }
  await expect.poll(alignedWithPeer).toBe(true)

  const beforeZoom = (await peerNode.boundingBox())!
  await page.mouse.move(beforeZoom.x + beforeZoom.width / 2, beforeZoom.y + beforeZoom.height / 2)
  await page.mouse.wheel(0, -180)
  await expect
    .poll(async () => {
      const afterZoom = await peerNode.boundingBox()
      return !!afterZoom && Math.abs(afterZoom.width - beforeZoom.width) > 3
    })
    .toBe(true)
  await expect.poll(alignedWithPeer).toBe(true)
  await page.keyboard.press('Escape')
  await expect(askDot).toHaveCount(0)

  await page.keyboard.press('c')
  await peerNode.click()
  const composer = page.getByPlaceholder('Note for the agent…')
  await expect(composer).toBeVisible()
  await composer.fill('Peer-domain targeting check')

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/domain/peer/comments',
  )
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  const comment = (await response.json()) as {
    id: string
    anchorRefs: Array<{ ref: string }>
  }
  expect(comment.anchorRefs).toContainEqual(expect.objectContaining({ ref: 'class.Company' }))

  const cleanup = await request.post('/api/domain/peer/comments', {
    data: { action: 'delete', id: comment.id },
  })
  expect(cleanup.ok()).toBe(true)
})
