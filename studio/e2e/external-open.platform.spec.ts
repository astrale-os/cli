import { expect, test } from '@playwright/test'

test('Chromium exposes a fresh inert popup until its opener is severed and navigation begins', async ({
  page,
}) => {
  await page.setContent('<button type="button">Open provider</button>')
  await page.getByRole('button', { name: 'Open provider' }).evaluate((button) => {
    button.addEventListener('click', () => {
      const opened = window.open('', '_blank', 'popup,width=720,height=760')
      if (opened === null) {
        document.body.dataset.outcome = 'blocked'
        return
      }
      opened.opener = null
      document.body.dataset.isolated = String(opened.opener === null)
      opened.location.replace('about:blank#provider')
      document.body.dataset.outcome = 'opened'
    })
  })

  const popupPromise = page.context().waitForEvent('page')
  await page.getByRole('button', { name: 'Open provider' }).click()
  const popup = await popupPromise

  await expect(page.locator('body')).toHaveAttribute('data-outcome', 'opened')
  await expect(page.locator('body')).toHaveAttribute('data-isolated', 'true')
  await expect.poll(() => popup.evaluate(() => window.opener)).toBeNull()
  await expect.poll(() => popup.url()).toContain('#provider')
  await popup.close()
})
