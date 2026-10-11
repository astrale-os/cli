/**
 * A domain begins as a conversation: the rail's plus opens the agent's own
 * composer, centred over the studio, with the name written above it like a
 * title.
 *
 * Nothing here sends: scaffolding shells out to npx and pnpm, which is not
 * something a browser test should set off. What is pinned is the door — what it
 * opens, what it refuses to send, what it does not carry, and that it closes.
 */
import { expect, test, type Page } from './test'

const card = (page: Page) => page.getByTestId('new-domain')

async function open(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('agent-dock')).toBeVisible()
  await page.getByRole('button', { name: 'New domain' }).click()
  await expect(card(page)).toBeVisible()
}

test('the plus opens the agent composer, name first, and Escape leaves the studio as it was', async ({
  page,
}) => {
  await open(page)
  const name = page.getByLabel('Domain name')
  const message = page.locator('[data-new-domain-composer]')

  // the name first — it is what the domain will be called, so it takes the caret
  await expect(name).toBeFocused()
  // the field, the clip, the send button. The fixture has no harness and this
  // composer does not care: the agent it will talk to does not exist yet either.
  await expect(message).toBeEnabled()
  await expect(card(page).getByRole('button', { name: 'Attach a document' })).toBeVisible()
  await expect(card(page).getByRole('button', { name: 'Create the domain' })).toBeVisible()
  // and none of what belongs to a domain that exists
  await expect(card(page).getByText('comment', { exact: false })).toHaveCount(0)
  await expect(card(page).getByTitle(/Click to change model/)).toHaveCount(0)

  // Enter on the name moves on to the message rather than sending
  await name.fill('billing')
  await name.press('Enter')
  await expect(message).toBeFocused()
  await expect(card(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(page.getByTestId('agent-dock')).toBeVisible()
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
