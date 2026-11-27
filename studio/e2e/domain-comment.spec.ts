import {
  dockWorkspacePanel,
  expect,
  FIXTURE_ID,
  inspector,
  openSchema,
  PEER_ID,
  restsInCanvas,
  sceneBox,
  sceneCanvas,
  test,
  type Page,
} from './test'

/**
 * Comments land on what they point at, in the Domain that owns it.
 *
 * A Domain takes a comment from its crumb, the one place that names it at the Schema level; a
 * frame drawing ANOTHER Domain's Classes takes one too, filed with the Domain being read. A
 * thread listed in the Comments panel then takes the reader back to its target, switching
 * Domain and level when it must.
 */

const ACTIVE = { origin: 'crm.studio-demo.astrale.ai', id: FIXTURE_ID }
const PEER = { origin: 'ops.studio-demo.astrale.ai', id: PEER_ID }
const BANNER = 'Comment mode — choose a domain element'

/** Enter comment mode and point at something, reporting what would be pinned. */
async function pointAt(page: Page, x: number, y: number): Promise<string | null> {
  await page.keyboard.press('c')
  await expect(page.getByText(BANNER)).toBeVisible()
  await page.mouse.move(x, y)
  return page.evaluate(
    () => document.querySelector('[data-comment-target]')?.getAttribute('data-anchor-ref') ?? null,
  )
}

/** Finish the comment the pointer opened, and report what the server stored and where. */
async function submit(page: Page, text: string, made: Array<{ domainId: string; id: string }>) {
  const composer = page.getByPlaceholder('Note for the agent…')
  await expect(composer).toBeVisible()
  await composer.fill(text)
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/comments'),
  )
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const response = await posted
  expect(response.ok()).toBe(true)
  const domainId = new URL(response.url()).pathname.split('/')[3]!
  const comment = (await response.json()) as { id: string; anchorRefs: unknown }
  made.push({ domainId, id: comment.id })
  await expect(composer).toHaveCount(0)
  return { domainId, anchorRefs: comment.anchorRefs }
}

/** The middle of an element, for the pointer. */
async function middle(page: Page, selector: string, at: 'start' | 'centre' = 'centre') {
  const box = (await page.locator(selector).first().boundingBox())!
  return { x: at === 'start' ? box.x + 6 : box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Comments on a Class of each Domain, made through the API; the returned list is what to delete. */
async function threads(page: Page) {
  const made: Array<{ domainId: string; id: string }> = []
  const create = async (domainId: string, name: string, text: string) => {
    const response = await page.request.post(`/api/domain/${domainId}/comments`, {
      data: {
        action: 'create',
        anchors: [name],
        anchorRefs: [{ ref: `class.${name}`, kind: 'schema' }],
        text,
      },
    })
    expect(response.ok()).toBe(true)
    made.push({ domainId, id: ((await response.json()) as { id: string }).id })
  }
  await create(PEER.id, 'Company', 'which regions does it cover?')
  await create(ACTIVE.id, 'Ticket', 'who triages these?')
  return made
}

test('a Domain takes a comment from its crumb, and another Domain’s frame from the canvas', async ({
  page,
  request,
}) => {
  const made: Array<{ domainId: string; id: string }> = []
  try {
    await openSchema(page)

    // ── the Domain being read, from its crumb ──
    const crumb = await middle(page, '[data-testid="level-domain"]', 'start')
    expect(await pointAt(page, crumb.x, crumb.y)).toBe(`domain.${ACTIVE.origin}`)
    await page.mouse.click(crumb.x, crumb.y)
    expect(await submit(page, 'the domain as a whole', made)).toEqual({
      domainId: ACTIVE.id,
      anchorRefs: [{ ref: `domain.${ACTIVE.origin}`, kind: 'section' }],
    })
    // the crumb now carries its thread
    await expect(
      page.getByRole('button', { name: `Comments on domain.${ACTIVE.origin}` }),
    ).toBeVisible()

    // ── a frame drawing another Domain's Classes, filed with the Domain being read ──
    const payments = 'domain.payments.studio-demo.astrale.ai'
    const label = await middle(page, `[data-region-id="${payments}"] .scene-region-label`, 'start')
    expect(await pointAt(page, label.x, label.y)).toBe(payments)
    await page.mouse.click(label.x, label.y)
    expect(await submit(page, 'the payments side of things', made)).toEqual({
      domainId: ACTIVE.id,
      anchorRefs: [{ ref: payments, kind: 'section' }],
    })
    await expect(
      sceneCanvas(page).locator(`[data-region-id="${payments}"] button[title="View comments"]`),
    ).toBeVisible()

    // ── the other Domain of the Workspace, from its own crumb ──
    const domain = page.getByTestId('level-domain')
    await domain.click()
    await page.getByRole('menuitemradio', { name: PEER.origin }).click()
    await expect(domain).toContainText(PEER.origin)
    await expect(sceneBox(page, 'class.Region')).toBeVisible()
    const peerCrumb = await middle(page, '[data-testid="level-domain"]', 'start')
    expect(await pointAt(page, peerCrumb.x, peerCrumb.y)).toBe(`domain.${PEER.origin}`)
    await page.mouse.click(peerCrumb.x, peerCrumb.y)
    // filed under the Domain the crumb names, not the one read before
    expect(await submit(page, 'a note on the other domain', made)).toEqual({
      domainId: PEER.id,
      anchorRefs: [{ ref: `domain.${PEER.origin}`, kind: 'section' }],
    })
  } finally {
    for (const { domainId, id } of made)
      await request.post(`/api/domain/${domainId}/comments`, { data: { action: 'delete', id } })
  }
})

test('a thread in the Comments panel takes the reader to its target, in its own Domain', async ({
  page,
  request,
}) => {
  const made = await threads(page)
  try {
    // docked left: in the bottom dock the agent composer sits over the panel's tabs
    await dockWorkspacePanel(request, 'left')
    await openSchema(page)
    await page.getByRole('button', { name: 'Comments', exact: true }).click()
    await expect(page.getByTestId(`comments-domain-${PEER.id}`)).toContainText(
      'which regions does it cover?',
    )

    // a thread of the other Domain switches the Schema to it, its Class selected and in view
    await page.getByText('which regions does it cover?').click()
    await expect(page.getByTestId('level-domain')).toContainText(PEER.origin)
    await expect(sceneBox(page, 'class.Company')).toHaveAttribute('data-selected', 'true')
    await expect(sceneBox(page, 'class.Invoice')).toHaveCount(0)
    await expect(
      inspector(page).getByRole('heading', { name: 'Company', exact: true }),
    ).toBeVisible()
    await restsInCanvas(page, sceneBox(page, 'class.Company'))

    // from the Workspace level, a thread opens the Schema again, back in the first Domain
    await page.getByTestId('level-workspace').click()
    await expect(page.getByTestId('schema-level')).toHaveCount(0)
    await page.getByText('who triages these?').click()
    await expect(page.getByTestId('schema-level')).toBeVisible()
    await expect(page.getByTestId('level-domain')).toContainText(ACTIVE.origin)
    await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')
    await expect(
      inspector(page).getByRole('heading', { name: 'Ticket', exact: true }),
    ).toBeVisible()
  } finally {
    for (const { domainId, id } of made)
      await request.post(`/api/domain/${domainId}/comments`, { data: { action: 'delete', id } })
  }
})

/*
 * A reveal asked for before the canvas is measured — a thread clicked at the Workspace level
 * opens the Schema and its canvas in the same step — is honoured once the canvas has its size,
 * and lands as a selection made in place does: where its card reads.
 */
test('from the Workspace level, a thread brings its Class into view', async ({ page, request }) => {
  const made = await threads(page)
  try {
    await dockWorkspacePanel(request, 'left')
    await openSchema(page)
    await page.getByRole('button', { name: 'Comments', exact: true }).click()
    await page.getByTestId('level-workspace').click()
    await expect(page.getByTestId('schema-level')).toHaveCount(0)
    await page.getByText('who triages these?').click()
    await expect(sceneBox(page, 'class.Ticket')).toHaveAttribute('data-selected', 'true')
    await restsInCanvas(page, sceneBox(page, 'class.Ticket'))
    const zoom = await sceneCanvas(page)
      .getByText(/^\d+%$/)
      .textContent()
    expect(Number.parseInt(zoom ?? '0', 10)).toBeGreaterThanOrEqual(64)
  } finally {
    for (const { domainId, id } of made)
      await request.post(`/api/domain/${domainId}/comments`, { data: { action: 'delete', id } })
  }
})

/*
 * The Workspace level draws each Domain whole, so a Domain's card takes a comment on the Domain:
 * anchored `domain.<origin>`, filed under that Domain, not under the Workspace map.
 */
test('a Domain takes a comment from its card at the Workspace level', async ({ page, request }) => {
  await openSchema(page)
  await page.getByTestId('level-workspace').click()
  const card = page.locator(`.scene-box[data-box-id="domain:${ACTIVE.id}"]`)
  await expect(card).toBeVisible()
  const box = (await card.boundingBox())!
  expect(await pointAt(page, box.x + box.width / 2, box.y + box.height / 2)).toBe(
    `domain.${ACTIVE.origin}`,
  )
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const made: Array<{ domainId: string; id: string }> = []
  try {
    expect(await submit(page, 'from the workspace map', made)).toEqual({
      domainId: ACTIVE.id,
      anchorRefs: [{ ref: `domain.${ACTIVE.origin}`, kind: 'section' }],
    })
  } finally {
    for (const { domainId, id } of made)
      await request.post(`/api/domain/${domainId}/comments`, { data: { action: 'delete', id } })
  }
})
