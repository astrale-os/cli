import {
  expect,
  FIXTURE_ID,
  indexRow,
  inspector,
  lensButton,
  type Locator,
  openSchema,
  type Page,
  sceneBox,
  test,
} from './test'

/**
 * One Class is drawn three times at once: its card on the canvas, its row in the Index, its page
 * in the Inspector. An Ask or a comment belongs to the one it was made on: it is found again
 * there after the surfaces redraw, never on a namesake on another surface.
 */

interface Surface {
  name: string
  /** the element the target is made on, as each surface draws it now */
  element: (page: Page) => Locator
  /** where to click it: a card's header, so the click lands on the card and not on a row */
  click: (page: Page) => Locator
  ref: string
}

const card: Surface = {
  name: 'card',
  element: (page) => sceneBox(page, 'class.Ticket'),
  click: (page) => sceneBox(page, 'class.Ticket').locator('.scene-box-header'),
  ref: 'class.Ticket',
}
const row: Surface = {
  name: 'Index row',
  element: (page) => indexRow(page, 'class.Ticket'),
  click: (page) => indexRow(page, 'class.Ticket'),
  ref: 'class.Ticket',
}
const property: Surface = {
  name: 'Inspector row',
  element: (page) => inspector(page).locator('[data-inspector-property="subject"]'),
  click: (page) => inspector(page).locator('[data-inspector-property="subject"]'),
  ref: 'class.Ticket.property.subject',
}

/** The fixture on its Schema, Ticket open in the Inspector under Structure. */
async function openTicket(page: Page): Promise<void> {
  await openSchema(page)
  await sceneBox(page, 'class.Ticket').click()
  await expect(property.element(page)).toBeVisible()
}

/** A lens round trip: every surface redraws, under another question and back. */
async function switchLens(page: Page): Promise<void> {
  await lensButton(page, 'behavior').click()
  await expect(property.element(page)).toHaveCount(0)
  await lensButton(page, 'structure').click()
  await expect(property.element(page)).toBeVisible()
}

test('an Ask stays on the surface it was made on through a lens switch', async ({ page }) => {
  // the agent answers at once and says nothing: an answered Ask outlives the click that
  // switches the lens, where a question never sent would be dropped by it
  await page.route('**/api/agent/ask', (route) => route.fulfill({ status: 200, body: '\n' }))
  await openTicket(page)
  const dot = page.getByTitle('Ask — answer ready', { exact: true })
  // the dot sits on the top-right corner of the element its Ask was made on
  const onCornerOf = (surface: Surface) => async () => {
    const element = await surface.element(page).boundingBox()
    const at = await dot.boundingBox()
    if (!element || !at) return 'nowhere'
    const x = at.x + at.width / 2 - (element.x + element.width - 10)
    const y = at.y + at.height / 2 - (element.y + 10)
    return Math.abs(x) < 2 && Math.abs(y) < 2 ? surface.name : 'elsewhere'
  }

  for (const surface of [card, row, property]) {
    await page.keyboard.press('a')
    await surface.click(page).click()
    const question = page.getByPlaceholder(/^Ask about /)
    await question.fill('What is this?')
    await question.press('ControlOrMeta+Enter')
    await expect(page.getByRole('button', { name: 'Ask another' })).toBeVisible()
    await expect.poll(onCornerOf(surface)).toBe(surface.name)

    // the redraw replaces the element; the Ask is found on the one that took its place on its
    // own surface, never on the same element drawn on another
    const made = await surface.element(page).elementHandle()
    await switchLens(page)
    expect(await made!.evaluate((element) => element.isConnected)).toBe(false)
    await expect.poll(onCornerOf(surface)).toBe(surface.name)

    await dot.click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dot).toHaveCount(0)
  }
})

test('a comment made on each surface is filed where it was made and shown there after a reload', async ({
  page,
  request,
}) => {
  await openTicket(page)
  const made: string[] = []
  for (const surface of [card, row, property]) {
    await page.keyboard.press('c')
    await surface.click(page).click()
    // the card and the Index row draw one Class: its thread, started on the card, is the one
    // the Index row opens, and a second comment joins it
    if (surface === row) {
      await expect(page.getByText('Made on the card')).toBeVisible()
      await page.getByRole('button', { name: 'Add a comment' }).click()
    }
    const composer = page.getByPlaceholder('Note for the agent…')
    await expect(composer).toBeVisible()
    // the composer points at the element it was opened on, not at a namesake
    await expect(surface.element(page)).toHaveAttribute('data-comment-draft-target', '')
    await composer.fill(`Made on the ${surface.name}`)
    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/domain/${FIXTURE_ID}/comments`,
    )
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    const comment = (await (await posted).json()) as {
      id: string
      anchorRefs: Array<{ ref: string }>
    }
    made.push(comment.id)
    expect(comment.anchorRefs).toEqual([expect.objectContaining({ ref: surface.ref })])
    await expect(composer).toHaveCount(0)
  }

  try {
    await switchLens(page)
    await page.reload()
    await expect(sceneBox(page, 'class.Ticket')).toBeVisible({ timeout: 60_000 })
    await sceneBox(page, 'class.Ticket').click()
    await expect(property.element(page)).toBeVisible()
    // the Class's two threads on the card, the field's one on the Inspector row it was made on
    await expect(card.element(page).locator('button[title="View comments"]')).toHaveText('2')
    await expect(
      property.element(page).getByRole('button', { name: `Comments on ${property.ref}` }),
    ).toBeVisible()
  } finally {
    for (const id of made) {
      const cleanup = await request.post(`/api/domain/${FIXTURE_ID}/comments`, {
        data: { action: 'delete', id },
      })
      expect(cleanup.ok()).toBe(true)
    }
  }
})

test('a comment made on a Domain card of the Workspace map is filed under that Domain and pinned on its card', async ({
  page,
  request,
}) => {
  await page.goto('/workspace')
  const crm = sceneBox(page, `domain:${FIXTURE_ID}`)
  await expect(crm).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('c')
  await crm.locator('.scene-box-header').click()
  const composer = page.getByPlaceholder('Note for the agent…')
  await expect(composer).toBeVisible()
  await composer.fill('Made on the Workspace map')
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/domain/${FIXTURE_ID}/comments`,
  )
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const comment = (await (await posted).json()) as { id: string }
  try {
    await expect(crm.locator('button[title="View comments"]')).toHaveText('1')
    await page.reload()
    await expect(crm.locator('button[title="View comments"]')).toHaveText('1', { timeout: 60_000 })
  } finally {
    const cleanup = await request.post(`/api/domain/${FIXTURE_ID}/comments`, {
      data: { action: 'delete', id: comment.id },
    })
    expect(cleanup.ok()).toBe(true)
  }
})
