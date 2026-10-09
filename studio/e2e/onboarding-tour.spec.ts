import { expect, test } from './test'

const STEPS = [
  'Welcome to Astrale Studio',
  'Domains',
  'The schema',
  'Four readings of one domain',
  'Comment on anything',
  'Hand it to the agent',
] as const

test('the tour never opens by itself and walks every step from Settings', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('workspace-schema-section')).toBeVisible()
  await expect(page.getByTestId('studio-tour')).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Start tour' }).click()

  const tour = page.getByTestId('studio-tour')
  const card = tour.getByRole('dialog')
  for (const [index, title] of STEPS.entries()) {
    await expect(card.getByRole('heading')).toHaveText(title)
    await expect(card).toContainText(`${index + 1} / ${STEPS.length}`)
    await expect(card).toBeInViewport()
    if (index < STEPS.length - 1) await card.getByRole('button', { name: 'Next' }).click()
  }

  await card.getByRole('button', { name: 'Back' }).click()
  await expect(card.getByRole('heading')).toHaveText(STEPS[STEPS.length - 2])
  await page.keyboard.press('ArrowRight')
  await card.getByRole('button', { name: 'Done' }).click()
  await expect(tour).toHaveCount(0)
})

test('the command palette starts the tour, and Escape leaves it without toggling a mode', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByPlaceholder('Search the schema…').fill('tour')
  await page.keyboard.press('Enter')

  const tour = page.getByTestId('studio-tour')
  await expect(tour.getByRole('heading')).toHaveText(STEPS[0])
  // C is the comment-mode hotkey; while the tour is open it belongs to the tour.
  await page.keyboard.press('c')
  await expect(page.getByRole('button', { name: 'Comment mode' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.keyboard.press('Escape')
  await expect(tour).toHaveCount(0)
})
