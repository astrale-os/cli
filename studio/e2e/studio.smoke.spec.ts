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
  await page.getByRole('button', { name: 'Schema', exact: true }).click()

  const monitorNode = page.getByText('Monitor', { exact: true }).first()
  await expect(monitorNode).toBeVisible()
  await monitorNode.click()

  await expect(page.getByRole('heading', { name: 'Monitor', exact: true })).toBeVisible()
  await expect(
    page.getByText('A monitored resource rendered by the browser smoke test.'),
  ).toBeVisible()
  await expect(page.getByText('label', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Core 1', exact: true }).click()
  const coreNode = page.getByRole('button', { name: /Primary monitor/ }).first()
  await expect(coreNode).toBeVisible()
  await coreNode.click()
  await expect(page.getByText('Browser fixture', { exact: true })).toBeVisible()
  await expect(
    page.getByText('/:studio-e2e.astrale.ai:core.primary', { exact: true }),
  ).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(requestFailures).toEqual([])
})
