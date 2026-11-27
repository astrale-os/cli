import { autoArrange, bareOffset, drag, layoutWrite, placeOf, settled } from './arrange'
import {
  expect,
  FIXTURE_ID,
  indexRail,
  inspector,
  lensButton,
  openSchema,
  PEER_ID,
  restsInCanvas,
  sceneBox,
  sceneCanvas,
  sceneLink,
  test,
  type Page,
} from './test'

/**
 * The Structure canvas draws the Domains around the open one as the reader chooses, in its
 * Domains control: each other Domain hidden, reached (the default) or whole. A Domain drawn whole
 * is an area of its own beside the open Domain's, framed and named, with the relationships
 * between the two drawn across. The choice and the arrangement are the Domain's, kept on the
 * server; the Index and the Inspector read each Domain as its own.
 *
 * The fixture's Ops Domain imports the Crm Domain's Team, and relates its Region to it.
 */

const CRM = 'crm.studio-demo.astrale.ai'
const OPS = 'ops.studio-demo.astrale.ai'
/** A Class the open Domain does not own, as its canvas names it. */
const of = (origin: string, name: string) => `class.${origin}:class.${name}`
const area = (page: Page, origin: string) =>
  page.locator(`.scene-area[data-area-id="area.${origin}"]`)
const way = (page: Page, origin: string, drawn: 'hidden' | 'reached' | 'whole') =>
  page.locator(`[data-domain-choice="${origin}"][data-drawn="${drawn}"]`)

/** Open the control, draw `origin` as asked, and close it again. */
async function draw(page: Page, origin: string, drawn: 'hidden' | 'reached' | 'whole') {
  await page.getByTestId('domains-control').click()
  await way(page, origin, drawn).click()
  await expect(way(page, origin, drawn)).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('domains-popover')).toHaveCount(0)
}

/** The screen rects of two elements do not meet. */
async function apart(page: Page, a: string, b: string) {
  const [one, two] = [
    (await page.locator(a).boundingBox())!,
    (await page.locator(b).boundingBox())!,
  ]
  return (
    one.x + one.width <= two.x ||
    two.x + two.width <= one.x ||
    one.y + one.height <= two.y ||
    two.y + two.height <= one.y
  )
}

async function openOps(page: Page) {
  await page.goto(`/domain/${encodeURIComponent(PEER_ID)}`)
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await expect(sceneBox(page, 'class.Region')).toBeVisible({ timeout: 60_000 })
}

/** Drag an area by its name, by a screen offset. */
async function dragArea(page: Page, origin: string, dx: number, dy: number) {
  const header = page.locator(`[data-area-header="area.${origin}"]`)
  const box = (await header.boundingBox())!
  const from = { x: box.x + Math.min(box.width / 2, 40), y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 })
  await page.mouse.up()
}

test('a Domain drawn whole is an area of its own, with the relationships to it, kept across a reload', async ({
  page,
  request,
}) => {
  await openOps(page)
  // reached, the default: the Class Ops imports sits in Crm's frame, and nothing else of Crm
  await expect(sceneBox(page, of(CRM, 'Team'))).toBeVisible()
  await expect(sceneBox(page, of(CRM, 'Invoice'))).toHaveCount(0)
  await expect(sceneCanvas(page).locator('.scene-area')).toHaveCount(0)

  await page.getByTestId('domains-control').click()
  const popover = page.getByTestId('domains-popover')
  await expect(popover.locator('[data-domain-home]')).toContainText('Ops')
  await expect(popover.locator(`[data-domain-row="${CRM}"]`)).toContainText('Crm')
  await expect(way(page, CRM, 'reached')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await draw(page, CRM, 'whole')

  // two framed areas, named, apart, both in view once the canvas fits them
  await expect(area(page, OPS)).toHaveAttribute('data-home', 'true')
  await expect(area(page, OPS).locator('.scene-area-label')).toHaveText('Ops')
  await expect(area(page, CRM).locator('.scene-area-label')).toHaveText('Crm')
  await expect(sceneBox(page, of(CRM, 'Invoice'))).toBeVisible()
  await expect(sceneBox(page, of(CRM, 'Invoice'))).not.toHaveAttribute('data-muted', 'true')
  expect(await apart(page, `[data-area-id="area.${OPS}"]`, `[data-area-id="area.${CRM}"]`)).toBe(
    true,
  )
  await restsInCanvas(page, area(page, OPS))
  await restsInCanvas(page, area(page, CRM))
  // the relationship from Ops's Region to Crm's Team runs between the two areas
  await expect(sceneLink(page, 'class.ServedBy')).toBeVisible()
  await expect(page.getByTestId('domains-control')).toContainText('2')

  // the choice is the Domain's, on the server, for this lens
  const layout = async () =>
    (await (await request.get(`/api/domain/${encodeURIComponent(PEER_ID)}/layout`)).json()) as {
      domains?: Record<string, Record<string, string>>
    }
  await expect.poll(async () => (await layout()).domains).toEqual({ structure: { [CRM]: 'whole' } })

  // the Index lists each Domain on its own
  for (const origin of [OPS, CRM])
    await expect(indexRail(page).locator(`[data-index-area="${origin}"]`)).toBeVisible()

  // the area drags whole by its name; a card drags inside its area
  const arranged = {
    area: await placeOf(page, of(CRM, 'Invoice'), 'class.Company'),
    card: await placeOf(page, 'class.Region', 'class.Company'),
  }
  await settled(page, of(CRM, 'Invoice'))
  const before = (await sceneBox(page, of(CRM, 'Invoice')).boundingBox())!
  const frameDropped = layoutWrite(page, 'set')
  await dragArea(page, CRM, 60, 40)
  expect((await frameDropped).ok()).toBe(true)
  const after = (await sceneBox(page, of(CRM, 'Invoice')).boundingBox())!
  expect(Math.round(after.x - before.x)).toBe(60)
  expect(Math.round(after.y - before.y)).toBe(40)
  const { dx, dy } = await bareOffset(page, 'class.Region')
  const cardDropped = layoutWrite(page, 'set')
  await drag(page, 'class.Region', dx, dy)
  expect((await cardDropped).ok()).toBe(true)
  const placed = {
    area: await placeOf(page, of(CRM, 'Invoice'), 'class.Company'),
    card: await placeOf(page, 'class.Region', 'class.Company'),
  }
  expect(placed.area).not.toEqual(arranged.area)
  expect(placed.card).not.toEqual(arranged.card)

  // a reload draws the same Domains, arranged as they were left
  await page.reload()
  await expect(area(page, CRM)).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(async () => ({
      area: await placeOf(page, of(CRM, 'Invoice'), 'class.Company'),
      card: await placeOf(page, 'class.Region', 'class.Company'),
    }))
    .toEqual(placed)

  // Auto-arrange lays the composed canvas out again, and keeps the Domains drawn
  await autoArrange(page).click()
  await expect
    .poll(async () => ({
      area: await placeOf(page, of(CRM, 'Invoice'), 'class.Company'),
      card: await placeOf(page, 'class.Region', 'class.Company'),
    }))
    .toEqual(arranged)
  await expect(area(page, CRM)).toBeVisible()
  expect((await layout()).domains).toEqual({ structure: { [CRM]: 'whole' } })

  // reached again, Crm is its frame of what Ops reaches
  await draw(page, CRM, 'reached')
  await expect(sceneCanvas(page).locator('.scene-area')).toHaveCount(0)
  await expect(sceneBox(page, of(CRM, 'Invoice'))).toHaveCount(0)
  await expect.poll(async () => (await layout()).domains).toBeUndefined()
})

test('another Domain drawn whole reads as its own: its page, its comments, and a way to open it', async ({
  page,
  request,
}) => {
  await openOps(page)
  await draw(page, CRM, 'whole')
  const invoice = sceneBox(page, of(CRM, 'Invoice'))
  await expect(invoice).toBeVisible()

  // its page names its Domain, and opens it there
  await invoice.click()
  const beside = page.locator(`[data-inspector-beside="${FIXTURE_ID}"]`)
  await expect(beside).toContainText('From Crm, drawn beside Ops')
  await expect(inspector(page)).toHaveAttribute('data-anchor-excerpt', 'Invoice')

  // a comment on it is filed under its Domain, anchored as that Domain names it
  await page.keyboard.press('Escape')
  await page.keyboard.press('c')
  await invoice.click()
  const composer = page.getByPlaceholder('Note for the agent…')
  await expect(composer).toBeVisible()
  await composer.fill('Filed under the Domain that declares it')
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/domain/${FIXTURE_ID}/comments`,
  )
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const response = await posted
  expect(response.ok()).toBe(true)
  const comment = (await response.json()) as { id: string; anchorRefs: Array<{ ref: string }> }
  expect(comment.anchorRefs).toContainEqual(expect.objectContaining({ ref: 'class.Invoice' }))
  const cleanup = await request.post(`/api/domain/${FIXTURE_ID}/comments`, {
    data: { action: 'delete', id: comment.id },
  })
  expect(cleanup.ok()).toBe(true)
  await page.keyboard.press('Escape')

  await invoice.click()
  await beside.locator('[data-open-beside]').click()
  await expect(page.getByTestId('level-domain')).toContainText(CRM)
  await expect(sceneBox(page, 'class.Invoice')).toBeVisible({ timeout: 60_000 })
  await expect(inspector(page)).toHaveAttribute('data-anchor-excerpt', 'Invoice')
  await expect(page).toHaveURL(/select=class\.Invoice/)
})

test('from the other side, the relationship comes in; a lens that reads one Domain lets go', async ({
  page,
}) => {
  await openSchema(page)
  await page.getByTestId('domains-control').click()
  // a Domain whose Schema the Studio cannot read is never drawn whole
  await expect(way(page, 'payments.studio-demo.astrale.ai', 'whole')).toBeDisabled()
  await page.keyboard.press('Escape')
  await draw(page, OPS, 'whole')

  await expect(area(page, CRM)).toHaveAttribute('data-home', 'true')
  await expect(area(page, OPS)).toBeVisible()
  // Ops's relationship to this Domain's Team, drawn from Ops's area
  await expect(sceneLink(page, of(OPS, 'ServedBy'))).toBeVisible()
  await expect(sceneBox(page, of(OPS, 'Region'))).toBeVisible()

  // a Class only Ops declares is read here while Structure draws it
  await sceneBox(page, of(OPS, 'Region')).click()
  await expect(page.locator(`[data-inspector-beside="${PEER_ID}"]`)).toBeVisible()
  await expect(page).toHaveURL(/select=class\.ops/)
  // Behavior reads this Domain alone: the selection is let go
  await lensButton(page, 'behavior').click()
  await expect(sceneCanvas(page).locator('.scene-band')).toHaveCount(3)
  await expect(page).not.toHaveURL(/select=/)
  // and Structure still draws Ops whole
  await lensButton(page, 'structure').click()
  await expect(area(page, OPS)).toBeVisible()
})
