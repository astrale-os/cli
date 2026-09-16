import type { StudioDataset, StudioSchemaBundle } from '../shared/types'

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
  await expect(page.getByText('Pick the demo facts the canvas draws.')).toHaveCount(0)
  await expect(page.getByText('nodes · edges', { exact: true })).toHaveCount(0)
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
  await expect(page.getByText('Declare demo data', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Scenario' })).toHaveCount(0)
})

test('schema policies open in the panel and show indirect consumers', async ({ page, request }) => {
  await policyScenario(page)
  await dockWorkspacePanel(request, 'left')
  await page.goto('/')
  await page.getByRole('button', { name: `Expand ${origin}`, exact: true }).click()
  const tree = page.getByTestId('workspace-domain-tree')
  const folder = tree.locator('[data-module-path="modules/billing"]')
  await expect(tree.getByRole('button', { name: 'modules', exact: true })).toHaveCount(0)
  await expect(folder.getByRole('button', { name: 'Invoice', exact: true })).toBeVisible()
  await expect(folder.getByRole('button', { name: 'closeBilling', exact: true })).toBeVisible()
  await folder.getByRole('button', { name: 'mayManageInvoice', exact: true }).click()
  const panel = page.getByRole('button', { name: 'Close panel' }).locator('..')
  await expect(panel.getByRole('heading', { name: 'mayManageInvoice', exact: true })).toBeVisible()
  const usages = panel
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Used by', exact: true }) })
  await expect(usages).toContainText('manageBilling')
  await expect(usages).toContainText('administerBilling')
  await expect(usages).toContainText('Invoice · read')
  await expect(usages).toContainText('Invoice.settle')
  await expect(usages).toContainText('closeBilling')
  await usages.getByRole('button', { name: 'administerBilling', exact: true }).first().click()
  await expect(panel.getByRole('heading', { name: 'administerBilling', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'manageBilling', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'manageBilling', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel' }).click()

  await page.getByText('Invoice', { exact: true }).first().click()
  await expect(panel.getByRole('heading', { name: 'Invoice', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'administerBilling', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'administerBilling', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await page.getByText('Invoice', { exact: true }).first().click()
  const method = panel.locator('[data-anchor-ref="class.Invoice.method.settle"]')
  await method.getByRole('button').first().click()
  await method.getByRole('button', { name: 'mayManageInvoice', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'mayManageInvoice', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Close panel' }).click()
  await folder.getByRole('button', { name: 'closeBilling', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'closeBilling', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'administerBilling', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'administerBilling', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Process', exact: true }).click()
  await page.getByRole('button', { name: 'administerBilling', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'administerBilling', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'manageBilling', exact: true }).click()
  await panel.getByRole('button', { name: 'mayManageInvoice', exact: true }).click()
  await panel.getByRole('button', { name: 'Test on a Dataset', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'mayManageInvoice', exact: true })).toBeVisible()
  await expect(panel).toContainText('Invoice · read')
  await expect(panel).toContainText('closeBilling')
  await panel.getByRole('button', { name: 'administerBilling', exact: true }).first().click()
  await expect(panel.getByRole('heading', { name: 'administerBilling', exact: true })).toBeVisible()
})
