import { expect, PEER_ID, sceneBox, test } from './test'

/**
 * Two Domains of the Workspace both declare a Class `Company`. Ask and comments aimed at the
 * other Domain's Company belong to that Domain: the Ask target names it, the comment is written
 * to its comments, anchored on its Class.
 */
test('Ask and comments keep the owning Domain for a homonymous Class', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('schema-level')).toBeVisible()
  const domain = page.getByTestId('level-domain')
  await domain.click()
  await page.getByRole('menuitemradio', { name: 'ops.studio-demo.astrale.ai' }).click()
  await expect(domain).toContainText('ops.studio-demo.astrale.ai')
  const company = sceneBox(page, 'class.Company')
  await expect(company).toBeVisible({ timeout: 60_000 })
  await expect(sceneBox(page, 'class.Invoice')).toHaveCount(0)

  await page.keyboard.press('a')
  await company.click()
  const askDot = page.getByTitle('Ask', { exact: true })
  await expect(page.getByPlaceholder('Ask about Company…')).toBeVisible()
  await expect(askDot).toBeVisible()

  // the dot sits on the card's corner, and stays there through a zoom
  const onCorner = async () => {
    const card = await company.boundingBox()
    const dot = await askDot.boundingBox()
    if (!card || !dot) return false
    const center = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 }
    return (
      Math.abs(center.x - (card.x + card.width - 10)) < 2 && Math.abs(center.y - (card.y + 10)) < 2
    )
  }
  await expect.poll(onCorner).toBe(true)
  const before = (await company.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.wheel(0, -180)
  await expect
    .poll(async () => {
      const after = await company.boundingBox()
      return !!after && Math.abs(after.width - before.width) > 3
    })
    .toBe(true)
  await expect.poll(onCorner).toBe(true)
  await page.keyboard.press('Escape')
  await expect(askDot).toHaveCount(0)

  await page.keyboard.press('c')
  await company.click()
  const composer = page.getByPlaceholder('Note for the agent…')
  await expect(composer).toBeVisible()
  await composer.fill('Peer-domain targeting check')
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/domain/${PEER_ID}/comments`,
  )
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const response = await posted
  expect(response.ok()).toBe(true)
  const comment = (await response.json()) as { id: string; anchorRefs: Array<{ ref: string }> }
  expect(comment.anchorRefs).toContainEqual(expect.objectContaining({ ref: 'class.Company' }))

  const cleanup = await request.post(`/api/domain/${PEER_ID}/comments`, {
    data: { action: 'delete', id: comment.id },
  })
  expect(cleanup.ok()).toBe(true)
})
