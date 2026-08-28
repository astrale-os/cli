import { expect, test } from '@playwright/test'

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
  expect(workspace).toEqual([expect.objectContaining({ origin: 'studio-e2e.astrale.ai' })])

  const domainId = workspace[0]?.id
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
  expect(bundle.ir?.classes).toHaveProperty('Monitor')

  await page.goto('/')
  await expect(page.getByTestId('domain-selector')).toContainText('studio-e2e.astrale.ai')
  // The gear is the ONLY way into per-domain settings — no palette entry, no shortcut —
  // so this opens the dialog rather than just counting the button: a mounted button over
  // an unmounted dialog is exactly the state that made the settings unreachable before.
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('Saved to .domain-studio/settings.json')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Fit View' })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Auto-arrange — discards manual positions' }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('option', { name: /Settings/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Schema', exact: true }).click()

  // one canvas draws the schema, whether the workspace holds one domain or several
  await expect(page.getByTestId('workspace-schema-canvas')).toBeVisible()
  // a declared view is a node on that canvas, not a panel behind a button
  await expect(page.getByRole('button', { name: 'overview', exact: true })).toBeVisible()

  // A domain frame is furniture you move, not a thing you open: grabbing it anywhere —
  // no header, no handle — drags it, exactly like a module box. Done here, on the freshly
  // fitted canvas, because that is the one moment the WHOLE frame is inside the pane and
  // its box is a place the mouse can actually reach. The grab point sits in the frame's
  // top-left padding: clear of its modules, and of the toolbar and controls. Dragged back
  // afterwards, so nothing downstream reads a canvas this test moved.
  const frame = page.locator('.react-flow__node-workspaceDomain').first()
  const frameTransform = () => frame.evaluate((el) => (el as HTMLElement).style.transform)
  // Wait for that premise instead of assuming it: until the fit has framed the whole
  // frame inside the pane, a point computed from its box may be off-screen, and a drag
  // there is a silent no-op rather than a failure that says why.
  await expect
    .poll(async () => {
      const inner = await frame.boundingBox()
      const pane = await page.getByTestId('workspace-schema-canvas').boundingBox()
      if (!inner || !pane) return false
      return (
        inner.x >= pane.x &&
        inner.y >= pane.y &&
        inner.x + inner.width <= pane.x + pane.width &&
        inner.y + inner.height <= pane.y + pane.height
      )
    })
    .toBe(true)
  const parked = await frameTransform()
  const frameBox = (await frame.boundingBox())!
  const grab = { x: frameBox.x + 16, y: frameBox.y + 40 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 80, grab.y + 40, { steps: 8 })
  await page.mouse.up()
  expect(await frameTransform()).not.toBe(parked)

  await page.mouse.move(grab.x + 80, grab.y + 40)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y, { steps: 8 })
  await page.mouse.up()

  // Give the canvas the whole window first. Selecting a class opens the detail panel and
  // NEVER pans the canvas to keep up — that is the contract — so with the agent panel also
  // docked the card can end up behind the detail panel, unmounted by
  // `onlyRenderVisibleElements`, and there is nothing left to measure.
  await page.getByRole('button', { name: 'Collapse the panel' }).click()
  await expect(page.getByRole('button', { name: 'Collapse the panel' })).toHaveCount(0)

  // A card wears its module hue as a 3px bar on the left and a hairline elsewhere…
  const card = page.locator('.react-flow__node-classNode > div').first()
  const cardEdges = () =>
    card.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        left: style.borderLeftWidth,
        top: style.borderTopWidth,
        padLeft: style.paddingLeft,
        ring: style.boxShadow !== 'none',
      }
    })
  // polled, not read once: React Flow re-creates a node's element as the canvas settles,
  // and computed styles read off the element it just replaced come back empty
  await expect.poll(cardEdges).toEqual({ left: '3px', top: '1px', padLeft: '10px', ring: false })

  const monitorNode = page.getByText('Monitor', { exact: true }).first()
  await expect(monitorNode).toBeVisible()
  await monitorNode.click()

  // …and selected, the SAME 3px on EVERY side: the bar drops to a hairline and hands its
  // 2px to the padding, so no side doubles up and the contents do not shift.
  await expect.poll(cardEdges).toEqual({ left: '1px', top: '1px', padLeft: '12px', ring: true })
  // selecting inside a domain never selects the domain
  await expect(page.locator('.react-flow__node-workspaceDomain.selected')).toHaveCount(0)

  await expect(page.getByRole('heading', { name: 'Monitor', exact: true })).toBeVisible()
  await expect(
    page.getByText('A monitored resource rendered by the browser smoke test.'),
  ).toBeVisible()
  await expect(page.getByText('label', { exact: true })).toBeVisible()

  // Pressing empty canvas unselects, and the detail panel goes with the selection that
  // opened it — a panel outliving its selection is a panel for nothing.
  const paneBox = (await page.getByTestId('workspace-schema-canvas').boundingBox())!
  const framedAt = (await frame.boundingBox())!
  // the fit leaves the frame floating in the pane, so the band above it is bare canvas —
  // and unlike the sides it stays clear of the toolbar (top-right) and controls (bottom)
  const emptyPoint = { x: paneBox.x + paneBox.width / 2, y: (paneBox.y + framedAt.y) / 2 }
  // assert the premise rather than assume it: a click that lands ON the frame would be a
  // node click, and the unselect it never tested would surface as a failure elsewhere
  expect(framedAt.y - paneBox.y).toBeGreaterThan(40)
  await page.mouse.click(emptyPoint.x, emptyPoint.y)
  // polled here for a second reason too: the ring fades out on a transition, so the frame
  // right after the click still carries a shrinking shadow
  await expect.poll(cardEdges).toEqual({ left: '3px', top: '1px', padLeft: '10px', ring: false })
  await expect(page.getByRole('heading', { name: 'Monitor', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Core', exact: true }).click()
  const coreNode = page.getByRole('button', { name: /Primary monitor/ }).first()
  await expect(coreNode).toBeVisible()
  await coreNode.click()
  const detailPanel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(detailPanel.getByText('Browser fixture', { exact: true })).toBeVisible()
  await expect(
    detailPanel.getByText('/:studio-e2e.astrale.ai:core.primary', { exact: true }),
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
