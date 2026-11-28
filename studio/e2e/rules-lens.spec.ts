import {
  FIXTURE_ID,
  expect,
  indexRail,
  indexRow,
  inspector,
  layoutRoute,
  lensButton,
  listedRows,
  openSchema,
  sceneBox,
  sceneCanvas,
  test,
  type Locator,
  type Page,
} from './test'

/**
 * Rules at the Schema level (DESIGN §6): the Structure map stays, relationships thin, and each
 * rule is read where it applies — a Class card lists its rule sites, the Inspector reads them as
 * sentences, who before what, and the Index lists the rules themselves.
 *
 * The fixture writes one read and traverse Policy on Ticket (`mayReadTicket`: the caller is its
 * reporter), `read: true` on Message, a call rule on `Invoice.settle` (`mayManageInvoice` on the
 * Invoice) and a contract with no Policy of its own on `Invoice.remind`; Team writes only
 * `read: true`. `mayReadOpportunity` and `mayReadSubscription` guard the reads of their Classes,
 * so three Policies open alike: `may read …`.
 */

const ORIGIN = 'crm.studio-demo.astrale.ai'

/** Where every card stands in the world, by id: the camera moving changes none of it. */
const places = (page: Page) =>
  page
    .locator('.scene-world')
    .evaluate((world) =>
      Object.fromEntries(
        [...world.querySelectorAll<HTMLElement>('.scene-box[data-box-id]')].map((box) => [
          box.dataset.boxId,
          box.style.transform,
        ]),
      ),
    )

/** Opens the Rules lens, and waits for its map: the canvas draws the last one until it is laid out. */
async function openRules(page: Page) {
  await openSchema(page)
  await page.keyboard.press('3')
  await expect(lensButton(page, 'rules')).toHaveAttribute('aria-pressed', 'true')
  await expect(sceneBox(page, 'rules.functions')).toBeVisible()
  await expect(sceneCanvas(page)).not.toHaveAttribute('data-laying-out', /.*/)
}

const rule = (page: Page, card: string, id: string) =>
  sceneBox(page, card).locator(`[data-rule-id="${id}"]`)

/**
 * A row's marks as the map draws them at its zoom: beside the row's phrase, or alone where the
 * map is too far out for phrases. The row holds both; one shows.
 */
const shownMarks = (row: Locator, marks: string) => row.locator(marks).filter({ visible: true })

/** A Policy's Index row, by its name: its id is `policy.<its Domain's key>:policy.<name>`. */
const policyRow = (page: Page, name: string) =>
  indexRail(page).locator(`[data-index-row^="policy."][data-index-row$=":policy.${name}"]`)

/** The band under the canvas a rule's walk and Figure stand on. */
const ruleStage = (page: Page) => page.getByTestId('rule-stage')

/** Selects a Class from its card's title, as the Rules Index lists rules, not Classes. */
const selectCard = async (page: Page, id: string) => {
  await sceneBox(page, id).locator('.scene-box-title').click()
  await expect(sceneBox(page, id)).toHaveAttribute('data-selected', 'true')
}

test('Rules keeps the Structure map and reads each Class card’s rules (U1, U3, U4)', async ({
  page,
}) => {
  await openRules(page)
  // the map is Structure's: every Class still drawn
  for (const id of ['class.Ticket', 'class.Message', 'class.Team', 'class.Invoice'])
    await expect(sceneBox(page, id)).toBeVisible()
  // one row per operation, in order: reading, then writing, then the calls and the constraints
  const ops = await sceneBox(page, 'class.Ticket')
    .locator('.scene-rule[data-depth="0"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-rule-op') ?? row.textContent))
  expect(ops.slice(0, 5)).toEqual(['read', 'traverse', 'create', 'update', 'delete'])
  // each row starts with whom it admits: a Policy's shield, read as what it asks — beside its
  // phrase, or alone where the map is too far out for phrases
  const ticket = rule(page, 'class.Ticket', 'class.Ticket#read')
  await expect(ticket).not.toHaveAttribute('data-unwritten', /.*/)
  await expect(shownMarks(ticket, '[data-rule-mark="policy"][data-rule-op="read"]')).toHaveCount(1)
  await expect(ticket.locator('.scene-rule-label')).toHaveText('read')
  await expect(ticket.locator('.scene-rule-text')).toContainText('you are its reporter')
  // the same rule on the next operation says so
  await expect(
    rule(page, 'class.Ticket', 'class.Ticket#traverse').locator('.scene-rule-text'),
  ).toHaveText('same as read')
  // where a Class writes nothing, the row says whom the Kernel admits, quietly, its mark drawn
  // hollow; the sentence is the row's own, on hover
  const team = rule(page, 'class.Team', 'class.Team#create')
  await expect(team).toHaveAttribute('data-unwritten', /.*/)
  await expect(team.locator('.scene-rule-text')).toHaveText('Owning Domain only')
  await expect(shownMarks(team, '.rule-mark[data-unwritten]')).toHaveCount(1)
  await team.hover()
  await expect(team).toHaveAttribute('data-hovered', /.*/)
  await expect(team).toHaveAttribute(
    'title',
    'Only Root, crm (its Domain) and holders of the create capability on Team may create one.',
  )
  // the Methods' call rules fold into one row, shut at rest
  const calls = rule(page, 'class.Invoice', 'class.Invoice#call')
  await expect(calls).toHaveAttribute('data-fold', 'shut')
  await expect(calls).toContainText('3 functions')
  // no row is cut in its middle: a row that does not fit ends with "…"
  const lines = await sceneCanvas(page).locator('.scene-rule-line').allTextContents()
  expect(lines.length).toBeGreaterThan(0)
  expect(lines.filter((line) => / … /.test(line))).toEqual([])
})

test('the Inspector reads a Class’s rules as sentences, the Policy as their detail (U2, U3)', async ({
  page,
}) => {
  await openSchema(page)
  await sceneBox(page, 'class.Ticket').click()
  await page.keyboard.press('3')
  const rules = inspector(page)
  await expect(rules).toHaveAttribute('data-inspector-lens', 'rules')
  const who = rules.locator('[data-rule-group="who"]')
  await expect(who.locator('[data-rule-site]')).not.toHaveCount(0)
  // a sentence first, the Policy's name its detail
  await expect(who).toContainText('You may read a ticket exactly when you are its reporter.')
  await expect(who.locator('[data-rule-policies]').first()).toContainText('mayReadTicket')
})

test('a function selected in Behavior arrives in Rules on its call rule (U1, U7)', async ({
  page,
}) => {
  await openSchema(page)
  await page.keyboard.press('2')
  await indexRow(page, 'function.Invoice.settle').click()
  await page.keyboard.press('3')
  await expect(lensButton(page, 'rules')).toHaveAttribute('aria-pressed', 'true')
  // the Inspector reads the function's own call rule
  const call = inspector(page).locator('[data-inspector-call]')
  await expect(call).toBeVisible()
  await expect(call).toContainText('mayManageInvoice')
  // on the map, the fold holding it is raised over the map — one row per rule, each naming the
  // functions it guards — and the function's row and its own name light
  const invoice = sceneBox(page, 'class.Invoice')
  await expect(invoice).toHaveAttribute('data-raised', 'true')
  const settle = rule(page, 'class.Invoice', 'class.Invoice.method.settle#call')
  await expect(settle).toHaveAttribute('data-lit', 'lit')
  await expect(settle.locator('[data-rule-name="function.Invoice.settle"]')).toHaveAttribute(
    'data-lit',
    'true',
  )
  await expect(invoice.locator('[data-rule-name="function.Invoice.remind"]')).not.toHaveAttribute(
    'data-lit',
    /.*/,
  )

  // the Class reads who may call each of its Methods, as its card does; a contract with no
  // Policy says who it admits, instead of showing nothing
  await selectCard(page, 'class.Invoice')
  const calls = inspector(page).locator('[data-inspector-calls]')
  await expect(calls.locator('[data-rule-fold-row]')).toHaveCount(3)
  await expect(calls).toContainText('settle')
  await expect(calls).toContainText('remind')
  await expect(calls).toContainText('search')
})

test('the Index lists the rules; selecting one lights every place it applies (U5, U6)', async ({
  page,
}) => {
  await openRules(page)
  const rested = await places(page)
  const policy = policyRow(page, 'mayReadTicket')
  await expect(policy).toBeVisible()
  // each entry says how many places it applies to
  await expect(policy).toContainText('2 places')
  await expect(policyRow(page, 'mayManageInvoice')).toContainText('1 place')
  await policy.click()
  await expect(rule(page, 'class.Ticket', 'class.Ticket#read')).toHaveAttribute('data-lit', 'lit')
  await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-emphasis', 'lit')
  await expect(sceneBox(page, 'class.Team')).toHaveAttribute('data-emphasis', 'dim')

  // a Policy whose places sit in a shut fold opens it over the map, and moves no card
  await policyRow(page, 'mayManageInvoice').click()
  await expect(sceneBox(page, 'class.Invoice')).toHaveAttribute('data-raised', 'true')
  await expect(rule(page, 'class.Invoice', 'class.Invoice.method.settle#call')).toHaveAttribute(
    'data-lit',
    'lit',
  )
  expect(await places(page)).toEqual(rested)
})

test('Policies whose names open alike are one family in the Index, each by the rest of its words', async ({
  page,
}) => {
  await openRules(page)
  const family = indexRow(page, 'policies.may-read')
  await expect(family).toContainText('May read')
  const others = indexRow(page, 'rules.who')
  await expect(others).toContainText('Other Policies')
  // the family's Policies by what follows the opening, then the one no family holds, in words
  const policy = (name: string) => `policy.${ORIGIN}:policy.${name}`
  const listed = (await listedRows(page)).filter(
    (id) => id.startsWith('policy.') || id === 'policies.may-read' || id === 'rules.who',
  )
  expect(listed).toEqual([
    'policies.may-read',
    policy('mayReadOpportunity'),
    policy('mayReadSubscription'),
    policy('mayReadTicket'),
    'rules.who',
    policy('mayManageInvoice'),
  ])
  await expect(policyRow(page, 'mayReadOpportunity')).toContainText('… Opportunity')
  await expect(policyRow(page, 'mayReadTicket')).toContainText('… Ticket')
  await expect(policyRow(page, 'mayManageInvoice')).toContainText('may manage Invoice')

  // a Policy is still found by its name as written
  await indexRail(page).getByLabel('Filter the Index').fill('mayReadTicket')
  await expect(indexRail(page).locator('[data-index-row^="policy."]')).toHaveCount(1)
  await expect(policyRow(page, 'mayReadTicket')).toBeVisible()
})

/**
 * A point of the canvas no card, link or control covers: somewhere a pan starts from. Found
 * from the `side` the pan leaves, so the hand stays on the canvas as it moves away from it.
 */
function barePoint(side: 'left' | 'right'): { x: number; y: number } {
  const canvas = document.querySelector('.scene-canvas')
  if (!canvas) throw new Error('no scene canvas on the page')
  const box = canvas.getBoundingClientRect()
  const taken =
    '.scene-box, .scene-link, .scene-ribbon, .scene-junction, [data-canvas-chrome], button'
  const [first, last, step] =
    side === 'left'
      ? [Math.ceil(box.left) + 8, box.right - 8, 6]
      : [Math.floor(box.right) - 8, box.left + 8, -6]
  for (let y = Math.ceil(box.top) + 60; y < box.bottom - 100; y += 6)
    for (let x = first; step > 0 ? x < last : x > last; x += step) {
      const el = document.elementFromPoint(x, y)
      if (el && canvas.contains(el) && !el.closest(taken)) return { x, y }
    }
  throw new Error('no bare canvas to grab')
}

/** Whether the centre of `id`'s row on `card` lies in the canvas, above the stage where it shows. */
const rowShows = async (page: Page, card: string, id: string) => {
  const pane = (await sceneCanvas(page).boundingBox())!
  const row = await rule(page, card, id).boundingBox()
  if (!row) return false
  const stage = await ruleStage(page).boundingBox()
  const bottom = Math.min(pane.y + pane.height, stage ? stage.y : Infinity)
  const x = row.x + row.width / 2
  const y = row.y + row.height / 2
  return x > pane.x && x < pane.x + pane.width && y > pane.y && y < bottom
}

/** Pans the map by hand until `id`'s row on `card` no longer shows. */
async function panAway(page: Page, card: string, id: string) {
  const pane = (await sceneCanvas(page).boundingBox())!
  const row = (await rule(page, card, id).boundingBox())!
  const away = row.x + row.width / 2 < pane.x + pane.width / 2 ? -1 : 1
  const side: 'left' | 'right' = away < 0 ? 'right' : 'left'
  for (let pans = 0; pans < 8 && (await rowShows(page, card, id)); pans++) {
    const from = await page.evaluate(barePoint, side)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + away * 280, from.y, { steps: 6 })
    await page.mouse.up()
  }
  expect(await rowShows(page, card, id)).toBe(false)
}

test('a rule’s places past the frame are pointed to from its edge; one click, or the Inspector, shows them (U6)', async ({
  page,
}) => {
  await openRules(page)
  await policyRow(page, 'mayReadTicket').click()
  const ticket = rule(page, 'class.Ticket', 'class.Ticket#read')
  await expect(ticket).toHaveAttribute('data-lit', 'lit')
  const pointers = sceneCanvas(page).locator('[data-offframe]')
  await expect.poll(() => rowShows(page, 'class.Ticket', 'class.Ticket#read')).toBe(true)
  await expect(pointers).toHaveCount(0)

  // panned away, the edge it lies past says how many places, toward them
  await panAway(page, 'class.Ticket', 'class.Ticket#read')
  await expect(pointers).not.toHaveCount(0)
  const pointer = pointers.first()
  await expect(pointer).toHaveAttribute('data-offframe', /^(left|right)$/)
  await expect(pointer).toContainText(/^\d+ places?$/)
  // each click shows the next, the rule still selected, until none is past the frame
  for (let clicks = 0; clicks < 4 && (await pointers.count()) > 0; clicks++) {
    await pointers.first().click()
    await expect(sceneCanvas(page)).not.toHaveAttribute('data-moving', /.*/)
    await page.waitForTimeout(400)
  }
  await expect(pointers).toHaveCount(0)
  await expect.poll(() => rowShows(page, 'class.Ticket', 'class.Ticket#read')).toBe(true)
  await expect(ticket).toHaveAttribute('data-lit', 'lit')

  // the Inspector's list of places does the same
  await panAway(page, 'class.Ticket', 'class.Ticket#read')
  await expect(pointers).not.toHaveCount(0)
  await inspector(page).locator('[data-place-jump="class.Ticket#read"]').click()
  await expect.poll(() => rowShows(page, 'class.Ticket', 'class.Ticket#read')).toBe(true)
  await expect(ticket).toHaveAttribute('data-lit', 'lit')
})

test('a fold opened by hand is laid out, and kept in the layout record: across a reload, in another browser (U3c)', async ({
  page,
  browser,
  request,
}) => {
  await openRules(page)
  // at rest the map is a glance, rows read as marks; a selected card lands where they read
  await selectCard(page, 'class.Invoice')
  await expect(sceneCanvas(page)).not.toHaveAttribute('data-glance', /.*/)
  const toggle = sceneBox(page, 'class.Invoice').locator('[data-fold-toggle="class.Invoice#call"]')
  await toggle.click()
  const calls = rule(page, 'class.Invoice', 'class.Invoice#call')
  await expect(calls).toHaveAttribute('data-fold', 'open')
  await expect(calls).toHaveAttribute('data-kept', 'true')
  await expect(rule(page, 'class.Invoice', 'class.Invoice.method.settle#call')).toBeVisible()
  // laid out, not raised: no card lies over another
  await expect(sceneBox(page, 'class.Invoice')).not.toHaveAttribute('data-raised', /.*/)
  const overlaps = await page.locator('.scene-world').evaluate((world) => {
    const boxes = [...world.querySelectorAll<HTMLElement>('.scene-box[data-box-kind="node"]')]
      .filter((box) => !box.closest('[data-leaving]'))
      .map((box) => ({ id: box.dataset.boxId, rect: box.getBoundingClientRect() }))
    const pairs: string[] = []
    for (const [index, a] of boxes.entries())
      for (const b of boxes.slice(index + 1))
        if (
          a.rect.left < b.rect.right - 1 &&
          b.rect.left < a.rect.right - 1 &&
          a.rect.top < b.rect.bottom - 1 &&
          b.rect.top < a.rect.bottom - 1
        )
          pairs.push(`${a.id} × ${b.id}`)
    return pairs
  })
  expect(overlaps).toEqual([])

  // kept with the lens's arrangement, on disk, not in this browser
  await expect
    .poll(async () => (await (await request.get(layoutRoute(FIXTURE_ID))).json()).opened)
    .toEqual({ rules: ['class.Invoice#call'] })
  await page.reload()
  await expect(lensButton(page, 'rules')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 60_000,
  })
  await expect(rule(page, 'class.Invoice', 'class.Invoice#call')).toHaveAttribute(
    'data-fold',
    'open',
  )
  // a second browser, sharing nothing with the first, reads it open too
  const second = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const other = await second.newPage()
  await openRules(other)
  await expect(rule(other, 'class.Invoice', 'class.Invoice#call')).toHaveAttribute(
    'data-fold',
    'open',
  )
  await second.close()
  // shut, it is shut in the record every reader reads
  await selectCard(page, 'class.Invoice')
  await toggle.click()
  await expect(calls).not.toHaveAttribute('data-fold', 'open')
  await expect
    .poll(async () => (await (await request.get(layoutRoute(FIXTURE_ID))).json()).opened)
    .toEqual({ rules: [] })
})

test('zoomed out, each row is a mark: hollow where nothing is written (U3b)', async ({ page }) => {
  await openRules(page)
  const zoomOut = sceneCanvas(page).locator('[data-canvas-chrome] button[aria-label="Zoom out"]')
  await expect(async () => {
    await zoomOut.click()
    await expect(sceneCanvas(page)).toHaveAttribute('data-glance', '', { timeout: 500 })
  }).toPass()
  // the phrases step back for marks
  await expect(
    rule(page, 'class.Ticket', 'class.Ticket#read').locator('.scene-rule-text'),
  ).toBeHidden()
  await expect(
    rule(page, 'class.Ticket', 'class.Ticket#read').locator('.scene-rule-glance'),
  ).toBeVisible()
  await expect(
    sceneBox(page, 'class.Team')
      .locator('[data-rule-id][data-unwritten] .scene-rule-glance')
      .first(),
  ).toBeVisible()
})

test('a rule’s walk stands on the stage under the canvas: numbered steps, the same numbers on its Figure and on the map (E)', async ({
  page,
}) => {
  await openRules(page)
  await policyRow(page, 'mayReadTicket').click()
  const stage = ruleStage(page)
  await expect(stage).toBeVisible()
  // the Inspector keeps the sentence; the walk and its Figure are the stage's
  await expect(inspector(page).locator('[data-policy-rule]')).toContainText('reporter')
  await expect(inspector(page).locator('[data-policy-rule] .vr-figure')).toHaveCount(0)
  const steps = stage.locator('[data-walk-step]')
  await expect(steps).toHaveText([/^1\s*Start at the Ticket$/, /^2\s*Follow \S+ to you$/])
  await expect(stage.locator('[data-figure-step]')).toHaveText(['1', '2'])
  await expect(sceneCanvas(page).locator('.scene-step[data-step-number="2"]')).toBeVisible()
  // the stage stands under the Inspector, never over it, and its Figure fits without a scroll
  const [panel, band] = [await inspector(page).boundingBox(), await stage.boundingBox()]
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(band!.y + 0.5)
  const frame = stage.locator('.studio-figure')
  await expect(frame).toHaveAttribute('data-figure-fit', 'fits')
  const host = frame.locator('.vr-figure-host')
  expect(await host.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)

  // pointing at a step stands its number out on the Figure and on the map
  await steps.nth(1).hover()
  await expect(steps.nth(1)).toHaveAttribute('data-pointed', '')
  await expect(stage.locator('[data-figure-step="2"]')).toHaveAttribute('data-pointed', '')
  await expect(sceneCanvas(page).locator('.scene-step[data-step-number="2"]')).toHaveAttribute(
    'data-pointed',
    '',
  )
  await expect(sceneCanvas(page).locator('.scene-step[data-step-number="1"]')).not.toHaveAttribute(
    'data-pointed',
    /.*/,
  )
  // the arrow keys step through, Esc lets go
  await page.mouse.move(0, 0)
  await stage.locator('[data-walk-steps]').focus()
  await page.keyboard.press('ArrowDown')
  await expect(steps.nth(0)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(steps.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(stage.locator('[data-figure-step="2"]')).toHaveAttribute('data-pointed', '')
  await page.keyboard.press('Escape')
  await expect(stage.locator('[data-walk-step][data-pointed]')).toHaveCount(0)
  await expect(policyRow(page, 'mayReadTicket')).toHaveAttribute('aria-selected', 'true')

  // a stage too narrow for the Figure: it scrolls, and says so from the edge under it
  await page.addStyleTag({ content: '[data-stage-figure] { max-width: 140px }' })
  await expect(frame).toHaveAttribute('data-figure-fit', 'scrolls')
  const more = frame.locator('[data-figure-more="right"]')
  await expect(more).toBeVisible()
  const [figure, under] = [await host.boundingBox(), await more.boundingBox()]
  expect(under!.y).toBeGreaterThanOrEqual(figure!.y + figure!.height)
  await more.click()
  await expect(frame.locator('[data-figure-more="left"]')).toBeVisible()
  expect(await host.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
})

test('the stage enlarges over the canvas and back, closes, and stays as it was left across a reload (E)', async ({
  page,
}) => {
  await openRules(page)
  await policyRow(page, 'mayReadTicket').click()
  const stage = ruleStage(page)
  await expect(stage).toBeVisible()
  const rest = (await stage.boundingBox())!.height
  // the floating composer steps aside for the stage: neither covers the other, and the stage's
  // own button brings it back in one click
  const dock = page.getByTestId('agent-dock')
  await expect(dock).toBeHidden()
  await stage.locator('[data-agent-aside]').click()
  await expect(dock).toBeVisible()
  await expect(dock.locator('[data-agent-composer]')).toBeFocused()
  // a click back on the stage puts it aside again
  await stage.getByText('Walk', { exact: true }).click()
  await expect(dock).toBeHidden()
  // enlarged, it stands over the canvas; Esc puts it back before it lets go of the selection
  await stage.locator('[data-stage-enlarge]').click()
  await expect(stage).toHaveAttribute('data-enlarged', '')
  const canvas = (await sceneCanvas(page).boundingBox())!
  expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(canvas.height - 0.5)
  await page.keyboard.press('Escape')
  await expect(stage).not.toHaveAttribute('data-enlarged', /.*/)
  expect((await stage.boundingBox())!.height).toBeCloseTo(rest, 0)
  await expect(policyRow(page, 'mayReadTicket')).toHaveAttribute('aria-selected', 'true')

  // closed, the Inspector offers it again where the walk stood, and a reload keeps it closed
  await stage.locator('[data-stage-close]').click()
  await expect(stage).toHaveCount(0)
  // and the composer is back where it floats
  await expect(dock).toBeVisible()
  const open = inspector(page).locator('[data-stage-open]')
  await expect(open).toBeVisible()
  await page.reload()
  await openRules(page)
  await policyRow(page, 'mayReadTicket').click()
  await expect(inspector(page).locator('[data-stage-open]')).toBeVisible()
  await expect(stage).toHaveCount(0)
  await inspector(page).locator('[data-stage-open]').click()
  await expect(stage).toBeVisible()
  await expect(stage.locator('[data-walk-step]')).toHaveCount(2)
})
