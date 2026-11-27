import { expect, inspector, sceneBox, sceneCanvas, test } from './test'

test('loads a canonical schema, opens it on the canvas and inspects a Class', async ({
  page,
  request,
}) => {
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

  await page.goto('/')
  // the Studio opens on the Domain's Schema, through Structure
  await expect(page.getByTestId('schema-level')).toBeVisible()
  await expect(
    page.getByTestId('lens-switch').locator('button[data-lens="structure"]'),
  ).toHaveAttribute('aria-pressed', 'true')
  const company = sceneBox(page, 'class.Company')
  await expect(company).toBeVisible({ timeout: 60_000 })
  // nothing selected, nothing to inspect
  await expect(inspector(page)).toHaveCount(0)

  await company.click()
  await expect(company).toHaveAttribute('data-selected', 'true')
  await expect(inspector(page).getByRole('heading', { name: 'Company', exact: true })).toBeVisible()
  await expect(inspector(page)).toContainText('An organisation we do business with.')
  // the Inspector takes its width beside the canvas, never over it
  const [canvas, panel] = [
    (await sceneCanvas(page).boundingBox())!,
    (await inspector(page).boundingBox())!,
  ]
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(panel.x + 1)

  // pressing bare canvas unselects, and the Inspector goes with the selection that opened it
  const bare = await page.evaluate(() => {
    const canvas = document.querySelector('.scene-canvas')!
    const box = canvas.getBoundingClientRect()
    const taken =
      '.scene-box, .scene-link, .scene-junction, [data-region-id], [data-canvas-chrome], button'
    for (let y = box.top + 8; y < box.bottom - 8; y += 6)
      for (let x = box.left + 8; x < box.right - 8; x += 6) {
        const el = document.elementFromPoint(x, y)
        if (el && canvas.contains(el) && !el.closest(taken)) return { x, y }
      }
    throw new Error('no bare canvas to press')
  })
  await page.mouse.click(bare.x, bare.y)
  await expect(company).not.toHaveAttribute('data-selected', 'true')
  await expect(inspector(page)).toHaveCount(0)

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(requestFailures).toEqual([])
})
