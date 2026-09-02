import { expect, test } from './test'

const detailLabels = [
  'Performance',
  'Detection',
  'Environment',
  'Model gateway',
  'Usage',
  'Loaded by the harness',
  'Injected system prompt',
  'Session ID',
  'Access',
] as const

test('keeps advanced settings behind the bottom-left Details control', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings' }).click()

  const dialog = page.getByRole('dialog')
  const details = dialog.getByRole('button', { name: 'Details', exact: true })
  await expect(details).toHaveAttribute('aria-expanded', 'false')

  for (const label of detailLabels)
    await expect(dialog.getByText(label, { exact: true }).first()).toBeHidden()

  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  for (const label of detailLabels)
    await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible()
  await expect(dialog.getByText('Performance', { exact: true })).toBeInViewport()

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Details', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')
})
