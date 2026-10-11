import type { StudioDataset, StudioSchemaBundle } from '../shared/contracts/schema'

import { dockWorkspacePanel, expect, type Page, test } from './test'

const origin = 'crm.studio-demo.astrale.ai'
const policyRef = (name: string) => ({ origin, kind: 'policy' as const, name })

test('authored policies share their module folder and root views remain below the folders', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: `Expand ${origin}`, exact: true }).click()
  const tree = page.getByTestId('workspace-domain-tree')
  const billing = tree.locator('[data-module-path="billing"]')
  await billing.getByRole('button', { name: 'mayManageInvoice', exact: true }).click()
  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(panel.getByRole('heading', { name: 'mayManageInvoice', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel' }).click()
  const overview = tree.getByRole('button', { name: 'overview', exact: true })
  const rootView = overview.locator('..')
  await expect(rootView.locator('xpath=ancestor::*[@data-module-path]')).toHaveCount(0)
  await overview.click()
  await expect(panel.getByRole('heading', { name: 'overview', exact: true })).toBeVisible()
})

async function policyScenario(page: Page) {
  await page.route('**/api/domain/*/bundle', async (route) => {
    const response = await route.fetch()
    const bundle = (await response.json()) as StudioSchemaBundle
    if (bundle.ir?.domain === origin) {
      for (const [ref, path] of Object.entries({
        'class.Invoice': 'classes/invoice.ts',
        'policy.mayManageInvoice': 'policies/may-manage-invoice.ts',
        'function.closeBilling': 'functions/close-billing.ts',
      }))
        bundle.overlay.sourceSpans[ref] = {
          file: 'schema/modules/billing/' + path,
          startLine: 1,
          endLine: 2,
        }
      bundle.ir.policies.manageBilling = { expression: { allOf: [policyRef('mayManageInvoice')] } }
      bundle.ir.policies.administerBilling = { expression: { anyOf: [policyRef('manageBilling')] } }
      bundle.ir.classes.Invoice!.policies = { read: policyRef('administerBilling') }
      bundle.ir.functions.closeBilling = {
        name: 'closeBilling',
        auth: 'authorized',
        input: { type: 'object' },
        output: { mode: 'value', schema: { type: 'boolean' } },
        policy: {
          check: policyRef('administerBilling'),
          object: { kind: 'input', field: 'invoice' },
        },
      }
    }
    await route.fulfill({ response, json: bundle })
  })
}

test('a policy lists its direct and indirect consumers, and each link opens both ways', async ({
  page,
  request,
}) => {
  await policyScenario(page)
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')
  await page.getByRole('button', { name: `Expand ${origin}`, exact: true }).click()
  const tree = page.getByTestId('workspace-domain-tree')
  const folder = tree.locator('[data-module-path="modules/billing"]')
  await expect(tree.getByRole('button', { name: 'modules', exact: true })).toHaveCount(0)
  await expect(folder.getByRole('button', { name: 'Invoice', exact: true })).toBeVisible()
  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  const heading = (name: string) => panel.getByRole('heading', { name, exact: true })
  const link = (name: string) => panel.getByRole('button', { name, exact: true }).first()
  const usages = panel
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Used by', exact: true }) })
  const method = panel.locator('[data-anchor-ref="class.Invoice.method.settle"]')
  const openPolicy = () =>
    folder.getByRole('button', { name: 'mayManageInvoice', exact: true }).click()
  const closePanel = () => page.getByRole('button', { name: 'Close panel' }).click()

  await openPolicy()
  await expect(heading('mayManageInvoice')).toBeVisible()
  for (const consumer of [
    'manageBilling',
    'administerBilling',
    'Invoice · read',
    'Invoice.settle',
    'closeBilling',
  ])
    await expect(usages).toContainText(consumer)

  // each consumer opens: a Class, a Method expanded inside it, a Function, a composing Policy
  await usages.getByRole('button', { name: 'Invoice', exact: true }).first().click()
  await expect(heading('Invoice')).toBeVisible()
  await expect(method.locator('[data-method-detail]')).toHaveCount(0)
  await openPolicy()
  await usages.getByRole('button', { name: 'settle', exact: true }).click()
  await expect(method.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
  await expect(method.locator('[data-method-detail]')).toBeInViewport()
  await openPolicy()
  await usages.getByRole('button', { name: 'closeBilling', exact: true }).click()
  await expect(heading('closeBilling')).toBeVisible()
  await openPolicy()
  await usages.getByRole('button', { name: 'administerBilling', exact: true }).first().click()
  await expect(heading('administerBilling')).toBeVisible()
  await link('manageBilling').click()
  await expect(heading('manageBilling')).toBeVisible()

  // and back: a Class, a Method and a Function name the Policy that guards them
  await closePanel()
  await page.getByText('Invoice', { exact: true }).first().click()
  await link('administerBilling').click()
  await expect(heading('administerBilling')).toBeVisible()
  await closePanel()
  await page.getByText('Invoice', { exact: true }).first().click()
  await method.getByRole('button').first().click()
  await method.getByRole('button', { name: 'mayManageInvoice', exact: true }).click()
  await expect(heading('mayManageInvoice')).toBeVisible()
  await closePanel()
  await folder.getByRole('button', { name: 'closeBilling', exact: true }).click()
  await link('administerBilling').click()
  await expect(heading('administerBilling')).toBeVisible()

  // the Process section and a Dataset's policy details carry the same links
  await page.getByRole('button', { name: 'Process', exact: true }).click()
  await page.getByRole('button', { name: 'administerBilling', exact: true }).click()
  await link('manageBilling').click()
  await link('mayManageInvoice').click()
  await link('Test on a Dataset').click()
  await expect(heading('mayManageInvoice')).toBeVisible()
  // a consuming Policy opens in place, still on the Dataset
  await usages.getByRole('button', { name: 'administerBilling', exact: true }).first().click()
  await expect(heading('administerBilling')).toBeVisible()
  await link('manageBilling').click()
  await link('mayManageInvoice').click()
  await usages.getByRole('button', { name: 'settle', exact: true }).click()
  await expect(heading('Invoice')).toBeVisible()
  await expect(method.locator('[data-method-detail]')).toBeInViewport()
})

test('datasets show only choices in the rail and the selected scenario on the canvas', async ({
  page,
}) => {
  const datasets: StudioDataset[] = ['First scenario', 'Second scenario'].map((title, i) => ({
    status: 'ready',
    path: `tests/scenario-${i}.ts`,
    id: `scenario-${i}`,
    title,
    description: `Description of scenario ${i}`,
    origin,
    revision: 'test',
    schemaMatch: true,
    references: {},
    variables: {},
    nodes: [{ path: `company-${i}`, className: 'Company', data: { name: 'Example' } }],
    edges: [],
  }))
  await page.route('**/api/domain/*/datasets', (route) =>
    route.fulfill({ json: { domainId: 'crm', datasets, extractedAt: '' } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Tests', exact: true }).click()
  const choices = page.getByRole('radiogroup', { name: 'Dataset drawn on the canvas' })
  await expect(choices.getByRole('radio').first()).toHaveText('First scenario')
  await expect(choices.getByRole('radio').last()).toHaveText('Second scenario')
  await expect(choices).not.toContainText('Description')
  const note = page.getByRole('complementary', { name: 'Scenario' })
  await expect(note).toContainText('Description of scenario 0')
  await choices.getByRole('radio', { name: 'Second scenario' }).click()
  await expect(note).toContainText('Description of scenario 1')
  await expect(note).not.toContainText('Description of scenario 0')
  const policies = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Policies' }) })
  await expect(policies).not.toHaveAttribute('open', '')
  await policies.locator('summary').click()
  await expect(policies.getByRole('button', { name: 'mayManageInvoice' })).toBeVisible()
})

test('the empty dataset state stays concise', async ({ page }) => {
  await page.route('**/api/domain/*/datasets', (route) =>
    route.fulfill({ json: { domainId: 'crm', datasets: [], extractedAt: '' } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Tests', exact: true }).click()
  await expect(page.getByText('No Dataset referenced', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Scenario' })).toHaveCount(0)
})
