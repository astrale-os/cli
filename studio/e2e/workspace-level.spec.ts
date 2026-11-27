import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ChangeReport, Remote } from '../shared/contracts/versions'

import { autoArrange, bareOffset, drag, layoutWrite, placeOf } from './arrange'
import { expect, FIXTURE_ID, PEER_ID, sceneBox, sceneCanvas, test, type Page } from './test'

/**
 * The Workspace level reads the Domains of the Workspace as cards, what they depend on as
 * links, the selected Domain as sentences, and the registry. This Studio's astrale home is
 * fresh and signed in to nothing, so every registry fact answers "signed out" — a state the
 * page must state, not hide.
 *
 * Publish is guarded twice over here: the E2E server runs with `ASTRALE_STUDIO_PUBLISH=off`,
 * so the Studio refuses every Publish before anything runs, and the look the dialog confirms
 * is a stub the server never issued. Only the refusal is ever reached.
 */

const crumb = (page: Page) => page.getByTestId('level-workspace')

async function openWorkspace(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await crumb(page).click()
  await expect(page.getByTestId('workspace-level')).toBeVisible()
}

test('the Workspace draws its Domains, what they depend on, and says it in sentences', async ({
  page,
}) => {
  await openWorkspace(page)
  const crm = sceneBox(page, `domain:${FIXTURE_ID}`)
  await expect(crm).toContainText('Crm')
  await expect(crm).toContainText('0.0.0')
  await expect(sceneBox(page, `domain:${PEER_ID}`)).toContainText('Ops')
  // a Domain depended on but not held is drawn too, and says so
  const kernel = sceneBox(page, 'origin:kernel.astrale.ai')
  await expect(kernel).toContainText('Kernel')
  await expect(kernel).toContainText('not in this Workspace')
  await expect(sceneBox(page, 'origin:payments.studio-demo.astrale.ai')).toContainText('Payments')
  for (const alias of ['kernel', 'payments'])
    await expect(
      sceneCanvas(page).locator(`g.scene-link[data-select-id="dependency:${FIXTURE_ID}:${alias}"]`),
    ).toBeVisible()

  const workspace = page.locator('[data-workspace-page="workspace"]')
  await expect(workspace).toContainText('This Workspace holds 2 Domains.')
  await expect(workspace).toContainText(
    '2 Domains outside it are depended on: Kernel and Payments.',
  )
  const domains = workspace.locator('[data-workspace-section="domains"]')
  await expect(domains.locator(`[data-workspace-domain="${FIXTURE_ID}"]`)).toContainText('Crm')
  await expect(domains.locator(`[data-workspace-domain="${PEER_ID}"]`)).toContainText('Ops')

  // the registry cannot be read signed out: the page says so, and how to fix it
  const registry = workspace.locator('[data-remote-status="signed-out"]').first()
  await expect(registry).toBeVisible()
  await expect(registry).toContainText('Signed out')
})

test('the Workspace map keeps its arrangement on this machine, for a reload and another browser', async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  const ops = `domain:${PEER_ID}`
  const crm = `domain:${FIXTURE_ID}`
  await openWorkspace(page)
  await expect(sceneBox(page, ops)).toBeVisible()
  // nothing placed yet: there is nothing to forget
  await expect(autoArrange(page)).toBeDisabled()
  // The map is read once its cards say all they will, and are laid out for it: what a card says
  // sets its width, and so where the cards beside it stand. Here every Domain's changes end as
  // "can't be judged".
  for (const id of [crm, ops])
    await expect(sceneBox(page, id)).toContainText("changes can't be judged")
  await expect(sceneCanvas(page)).not.toHaveAttribute('data-laying-out', /.*/)
  const arranged = await placeOf(page, ops, crm)

  // the drop is written to the Workspace's record, under the map's lens, and to no Domain
  const placedWrite = layoutWrite(page, 'set')
  const { dx, dy } = await bareOffset(page, ops)
  await drag(page, ops, dx, dy)
  const placedResponse = await placedWrite
  expect(new URL(placedResponse.url()).pathname).toBe('/api/workspace/layout')
  expect(placedResponse.request().postDataJSON()?.lens).toBe('map')
  const dropped = await placeOf(page, ops, crm)
  expect(dropped).not.toEqual(arranged)
  await expect(autoArrange(page)).toBeEnabled()
  const written = async () =>
    (
      (await (await request.get('/api/workspace/layout')).json()) as {
        lenses?: Record<string, Record<string, unknown>>
      }
    ).lenses ?? {}
  expect(Object.keys(await written())).toEqual(['map'])
  for (const domain of [FIXTURE_ID, PEER_ID]) {
    const layout = (await (
      await request.get(`/api/domain/${encodeURIComponent(domain)}/layout`)
    ).json()) as { lenses?: Record<string, unknown> }
    expect(layout.lenses ?? {}).toEqual({})
  }

  // a reload finds it where it was left (the level is not kept: the page opens on the Schema)
  await openWorkspace(page)
  await expect.poll(() => placeOf(page, ops, crm)).toEqual(dropped)

  // so does another browser
  const other = await browser.newContext({ baseURL })
  try {
    const second = await other.newPage()
    await openWorkspace(second)
    await expect.poll(() => placeOf(second, ops, crm)).toEqual(dropped)
  } finally {
    await other.close()
  }

  // Auto-arrange forgets the placement, on screen and on disk; its Undo restores both
  const forgotten = layoutWrite(page, 'reset')
  await autoArrange(page).click()
  await expect(page.getByText('The Workspace map is arranged automatically again')).toBeVisible()
  await expect.poll(() => placeOf(page, ops, crm)).toEqual(arranged)
  expect((await forgotten).ok()).toBe(true)
  expect((await written()).map).toBeUndefined()
  const restored = layoutWrite(page, 'set')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => placeOf(page, ops, crm)).toEqual(dropped)
  expect((await restored).ok()).toBe(true)
  await openWorkspace(page)
  await expect.poll(() => placeOf(page, ops, crm)).toEqual(dropped)
})

test('a Domain reads as its standing, its changes, where it publishes, and its dependencies', async ({
  page,
}) => {
  await openWorkspace(page)
  await sceneBox(page, `domain:${FIXTURE_ID}`).click()
  const domain = page.locator('[data-workspace-page="domain"]')
  await expect(domain).toHaveAttribute('data-domain-name', 'Crm')
  for (const section of ['standing', 'changes', 'publish', 'dependencies'])
    await expect(domain.locator(`[data-workspace-section="${section}"]`)).toBeVisible()
  // where it stands against the registry cannot be told signed out
  await expect(domain.locator('[data-relation="undetermined"]')).toBeVisible()
  await expect(domain.locator('[data-workspace-section="publish"]')).toContainText(
    'Publishes to development.',
  )
  const dependencies = domain.locator('[data-workspace-section="dependencies"]')
  await expect(dependencies).toContainText('Kernel')
  await expect(dependencies).toContainText('Payments')

  // a selected dependency link reads as its own page: clicked on its line, wherever it bends
  const middle = await sceneCanvas(page)
    .locator(`g.scene-link[data-select-id="dependency:${FIXTURE_ID}:payments"] .scene-link-hit`)
    .evaluate((el) => {
      const path = el as SVGPathElement
      const at = path.getPointAtLength(path.getTotalLength() / 2)
      const m = path.getScreenCTM()!
      return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f }
    })
  await page.mouse.click(middle.x, middle.y)
  await expect(page.locator('[data-workspace-page="dependency"]')).toBeVisible()
})

/** The look the dialog takes, stubbed: accepted, nothing to compare. The server never issued it. */
async function stubLook(page: Page, revision: string) {
  await page.route('**/api/domain/*/versions/changes*', (route) => {
    const remote: Remote<ChangeReport> = {
      status: 'ok',
      readAt: new Date().toISOString(),
      value: {
        look: 'e2e-look-never-issued',
        origin: 'crm.studio-demo.astrale.ai',
        declared: '0.0.0',
        published: false,
        registry: 'unregistered',
        accepted: true,
        changes: [],
        revision: revision as ChangeReport['revision'],
        judgedAt: new Date().toISOString(),
        notes: [],
      },
    }
    return route.fulfill({ json: remote })
  })
}

test("the bar's refresh reads again where a Domain stands, its changes and its dependencies", async ({
  page,
}) => {
  const base = `/api/domain/${encodeURIComponent(FIXTURE_ID)}/versions`
  const paths = [base, `${base}/changes`, `${base}/dependencies`]
  const answered = new Map<string, number>()
  page.on('requestfinished', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && paths.includes(path))
      answered.set(path, (answered.get(path) ?? 0) + 1)
  })
  const counts = () => paths.map((path) => answered.get(path) ?? 0)

  await openWorkspace(page)
  await sceneBox(page, `domain:${FIXTURE_ID}`).click()
  const domain = page.locator('[data-workspace-page="domain"]')
  await expect(domain.locator('[data-relation="undetermined"]')).toBeVisible()
  // every fact is read once, then held
  await expect.poll(() => counts().every((count) => count >= 1)).toBe(true)
  const before = counts()

  await page.getByRole('button', { name: 'Refresh domains' }).click()
  await expect(page.getByText('Domains refreshed')).toBeVisible()
  await expect
    .poll(() => counts().every((count, index) => count > before[index]!), { timeout: 30_000 })
    .toBe(true)
  await expect(domain.locator('[data-relation="undetermined"]')).toBeVisible()
})

test('Publish asks for every guard, then the Studio refuses it before anything runs', async ({
  page,
  request,
}) => {
  // A working tree with a file git does not track is no clean commit, wherever the suite runs:
  // publishing it as it is must be acknowledged.
  const untracked = join(import.meta.dirname, `.publish-spec-${process.pid}.tmp`)
  writeFileSync(untracked, '')
  try {
    const bundle = (await (
      await request.get(`/api/domain/${encodeURIComponent(FIXTURE_ID)}/bundle`)
    ).json()) as { schemaRevision: string }
    await stubLook(page, bundle.schemaRevision)
    const publishes: string[] = []
    page.on('request', (sent) => {
      if (sent.url().includes('/versions/publish')) publishes.push(sent.method())
    })

    await openWorkspace(page)
    await sceneBox(page, `domain:${FIXTURE_ID}`).click()
    await page.locator('[data-workspace-page="domain"] [data-action="publish"]').click()
    const dialog = page.locator('[data-publish-dialog="review"]')
    await expect(dialog).toBeVisible()

    // nothing is ready until every guard is answered, and each missing one is named
    const confirm = dialog.locator('[data-action="confirm-publish"]')
    await expect(confirm).toBeDisabled()
    await expect(dialog).toContainText('Choose an Environment.')
    await expect(dialog).toContainText('Type 0.0.0 to confirm.')

    await dialog.getByRole('radio', { name: /development/ }).check()
    await expect(dialog).not.toContainText('Choose an Environment.')
    await expect(confirm).toBeDisabled()
    const dirty = dialog.getByRole('checkbox', { name: /--allow-dirty/ })
    await expect(dirty).toBeVisible()
    await dirty.check()

    const typed = dialog.getByLabel('Type 0.0.0 to confirm')
    await typed.fill('0.0.1')
    await expect(confirm).toBeDisabled()
    await typed.fill('0.0.0')
    await expect(confirm).toBeEnabled()
    await expect(confirm).toHaveText('Publish 0.0.0 to development')
    expect(publishes).toEqual([])

    await confirm.click()
    const refused = page.locator('[data-publish-result="refused"]')
    await expect(refused).toBeVisible()
    await expect(refused).toHaveAttribute('data-refusal', 'publish-disabled')
    await expect(refused).toContainText('Nothing ran: the Studio refused before publishing.')
    expect(publishes).toEqual(['POST'])
  } finally {
    rmSync(untracked, { force: true })
  }
})
