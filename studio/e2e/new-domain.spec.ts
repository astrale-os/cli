/**
 * A domain begins as a conversation: the rail's plus opens the agent's own
 * composer, centred over the studio, with the name written above it like a
 * title.
 *
 * Nothing here sends: scaffolding shells out to npx and pnpm, which is not
 * something a browser test should set off. What is pinned is the door — what it
 * opens, what it refuses to send, what it does not carry, and that it closes.
 */
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    __frames?: { x: number; width: number }[]
  }
}

const card = (page: Page) => page.getByTestId('new-domain')

async function open(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('agent-dock')).toBeVisible()
  await page.getByRole('button', { name: 'New domain' }).click()
  await expect(card(page)).toBeVisible()
}

test('the plus opens the composer the agent has everywhere else', async ({ page }) => {
  await open(page)

  // the name first — it is what the domain will be called, so it takes the caret
  await expect(page.getByLabel('Domain name')).toBeFocused()

  // the field, the clip, the send button. The fixture has no harness and this
  // composer does not care: the agent it will talk to does not exist yet either.
  await expect(page.locator('[data-new-domain-composer]')).toBeEnabled()
  await expect(card(page).getByRole('button', { name: 'Attach a document' })).toBeVisible()
  await expect(card(page).getByRole('button', { name: 'Create the domain' })).toBeVisible()

  // and none of what belongs to a domain that exists
  await expect(card(page).getByText('comment', { exact: false })).toHaveCount(0)
  await expect(card(page).getByTitle(/Click to change model/)).toHaveCount(0)
})

test('it takes both halves: a name, and what the domain is for', async ({ page }) => {
  await open(page)
  const send = card(page).getByRole('button', { name: 'Create the domain' })
  const name = page.getByLabel('Domain name')
  const message = page.locator('[data-new-domain-composer]')

  // a message with no name is not a domain
  await message.fill('Model invoices')
  await expect(send).toBeDisabled()

  // a name that is not a slug says so, and still cannot go
  await name.fill('Not A Slug')
  await expect(card(page)).toContainText('lowercase')
  await expect(send).toBeDisabled()

  await name.fill('billing')
  await expect(card(page)).not.toContainText('lowercase')
  await expect(send).toBeEnabled()

  // and a name on its own cannot either: a scaffold nobody asked anything of
  // is a folder, and there would be no turn to open the domain on
  await message.fill('   ')
  await expect(send).toBeDisabled()
})

test('it arrives centred, and is centred the whole way in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('agent-dock')).toBeVisible()

  // sample the card on every frame it exists for: the entrance animates the same
  // properties Tailwind centres it with, and animating the WRONG ones once flew
  // it in from off-screen left
  await page.evaluate(() => {
    window.__frames = []
    const tick = () => {
      const element = document.querySelector('[data-testid="new-domain"]')
      if (element) {
        const box = element.getBoundingClientRect()
        window.__frames?.push({ x: box.x, width: box.width })
      }
      if ((window.__frames?.length ?? 0) < 20) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.getByRole('button', { name: 'New domain' }).click()
  await expect(card(page)).toBeVisible()
  await page.waitForTimeout(600)

  const frames = await page.evaluate(() => window.__frames ?? [])
  expect(frames.length).toBeGreaterThan(5)
  const centres = frames.map((frame) => frame.x + frame.width / 2)
  expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1)
})

test('Enter on the name goes to the message rather than sending', async ({ page }) => {
  await open(page)
  await page.getByLabel('Domain name').fill('billing')
  await page.getByLabel('Domain name').press('Enter')

  await expect(page.locator('[data-new-domain-composer]')).toBeFocused()
  // still here: nothing was created by a keystroke meant to move on
  await expect(card(page)).toBeVisible()
})

test('it closes on Escape, and the studio is where it was', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Escape')

  await expect(card(page)).toHaveCount(0)
  await expect(page.getByTestId('agent-dock')).toBeVisible()
})
