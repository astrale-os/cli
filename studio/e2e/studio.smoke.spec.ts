import { dockWorkspacePanel, expect, test } from './test'

test('loads a canonical schema and opens a class detail', async ({ page, request }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const requestFailures: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (failed) => {
    requestFailures.push(`${failed.method()} ${failed.url()}: ${failed.failure()?.errorText ?? ''}`)
  })

  const workspaceResponse = await request.get('/api/workspace')
  expect(workspaceResponse.ok()).toBe(true)
  const workspace = (await workspaceResponse.json()) as Array<{ id: string; origin: string }>
  expect(workspace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ origin: 'crm.studio-demo.astrale.ai' }),
      expect.objectContaining({ origin: 'ops.studio-demo.astrale.ai' }),
    ]),
  )

  const domainId = workspace.find((domain) => domain.origin === 'crm.studio-demo.astrale.ai')?.id
  expect(domainId).toBeTruthy()
  const bundleResponse = await request.get(`/api/domain/${encodeURIComponent(domainId!)}/bundle`)
  expect(bundleResponse.ok()).toBe(true)
  const bundle = (await bundleResponse.json()) as {
    schemaMode?: string
    schemaRevision?: string
    ir?: { classes?: Record<string, unknown> }
  }
  expect(bundle.schemaMode).toBe('canonical-admitted')
  expect(bundle.schemaRevision).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(bundle.ir?.classes).toHaveProperty('Company')
  expect(bundle.ir?.classes).toHaveProperty('Invoice')
  expect(bundle.ir?.classes?.Invoice).toMatchObject({
    methods: { settle: { abstract: true, executable: true } },
  })
  expect(bundle.ir?.classes).toHaveProperty('Subscription')

  // Dock the work panel to a side for this run. The studio now starts on the floating
  // dock, which docks nothing — so the canvas is fitted across the WHOLE window, and the
  // detail panel a selection opens later takes its width back out of the pane, leaving
  // the graph's right half outside it. `onlyRenderVisibleElements` then unmounts the very
  // card the assertions below measure. Docked and collapsed, the fit happens in the pane
  // the card is measured in. Where the panel lives is bottom-dock.spec.ts's subject, not
  // this one's.
  await dockWorkspacePanel(request, 'left')

  await page.goto('/')
  // The rail says what the canvas draws through the eye; it has no active-domain state.
  const crmRow = page
    .getByTestId('workspace-domain-tree')
    .locator('[data-tree-row][data-anchor-ref="domain.crm.studio-demo.astrale.ai"]')
  await expect(crmRow).toBeVisible()
  await expect(
    crmRow.getByRole('button', { name: 'Hide crm.studio-demo.astrale.ai on the canvas' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Schema', exact: true }).click()

  // one canvas draws the schema, whether the workspace holds one domain or several
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  // a declared view is a node on that canvas, not a panel behind a button
  await expect(page.getByRole('button', { name: 'overview', exact: true })).toBeVisible()

  // Give the canvas the whole window first. Selecting a class opens the detail panel and
  // NEVER pans the canvas to keep up — that is the contract — so with the agent panel also
  // docked the card can end up behind the detail panel, unmounted by
  // `onlyRenderVisibleElements`, and there is nothing left to measure.
  await page.getByRole('button', { name: 'Collapse the panel' }).click()
  await expect(page.getByRole('button', { name: 'Collapse the panel' })).toHaveCount(0)

  const companyNode = page.getByText('Company', { exact: true }).first()
  const card = page.locator('.react-flow__node-classNode').filter({ has: companyNode })
  await companyNode.click()
  await expect(card).toHaveClass(/selected/)
  // selecting inside a domain never selects the domain
  await expect(page.locator('.react-flow__node-workspaceDomain.selected')).toHaveCount(0)

  await expect(page.getByRole('heading', { name: 'Company', exact: true })).toBeVisible()
  await expect(page.getByText('An organisation we do business with.')).toBeVisible()
  await expect(page.getByText('legalName', { exact: true })).toBeVisible()

  // Pressing empty canvas unselects, and the detail panel goes with the selection that
  // opened it — a panel outliving its selection is a panel for nothing.
  const paneBox = (await page.getByTestId('workspace-schema-canvas').boundingBox())!
  const frameTop = async () =>
    (await page.locator('.react-flow__node-workspaceDomain').first().boundingBox())!.y
  // the fit leaves the frame floating in the pane, so the band above it is bare canvas —
  // and unlike the sides it stays clear of the toolbar (top-right) and controls (bottom).
  // Waited for rather than assumed: a click that lands ON the frame would be a node click
  await expect.poll(async () => (await frameTop()) - paneBox.y).toBeGreaterThan(40)
  const emptyPoint = { x: paneBox.x + paneBox.width / 2, y: (paneBox.y + (await frameTop())) / 2 }
  await page.mouse.click(emptyPoint.x, emptyPoint.y)
  await expect(card).not.toHaveClass(/selected/)
  await expect(page.getByRole('heading', { name: 'Company', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Core', exact: true }).click()
  const coreNode = page.getByRole('button', { name: /Platform/ }).first()
  await expect(coreNode).toBeVisible()
  await coreNode.click()
  const detailPanel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(detailPanel.getByText('EU', { exact: true })).toBeVisible()
  await expect(
    detailPanel.getByText('/:crm.studio-demo.astrale.ai:core.platform', { exact: true }),
  ).toBeVisible()

  // The rail beside the tree is empty space too: clicking it unselects exactly like the
  // canvas pane does, and closes the panel the row had opened.
  await page.getByTestId('modules-sidebar').click({ position: { x: 40, y: 320 } })
  await expect(page.getByRole('button', { name: 'Close panel' })).toHaveCount(0)
  await expect(coreNode).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(requestFailures).toEqual([])
})
