import type { InstancesState } from '@shared/contracts/workspace'

import { expect, FIXTURE_ID, test } from './test'

/**
 * Studio works only with instances its user owns in Admin; the others stay listed. The active
 * instance is chosen where it matters, beside a View's Open action on its page, and nowhere else.
 */
const instances: InstancesState = {
  active: 'team',
  instances: [
    {
      name: 'mine',
      url: 'https://mine.eu.astrale.ai/api',
      active: false,
      kind: 'bookmark',
      owned: true,
    },
    {
      name: 'team',
      url: 'https://team.eu.astrale.ai/api',
      active: true,
      kind: 'bookmark',
      owned: false,
      reason: 'Not owner',
    },
    {
      name: 'dev',
      url: 'http://127.0.0.1:7200',
      active: false,
      kind: 'bookmark',
      owned: false,
      reason: 'Not an Admin instance',
    },
  ],
}

test('instances the user does not own are listed but cannot be picked; an active one warns', async ({
  page,
}) => {
  const switched: string[] = []
  await page.route('**/api/instances', (route) => route.fulfill({ json: instances }))
  await page.route('**/api/instances/use', (route) => {
    switched.push(String((route.request().postDataJSON() as { name: string }).name))
    return route.fulfill({ json: { ok: true, active: 'mine', output: '' } })
  })

  await page.goto(`/domain/${encodeURIComponent(FIXTURE_ID)}?lens=views&select=view.overview`)
  const viewPage = page.locator('[data-inspector-view="overview"]')
  const trigger = viewPage.getByRole('button', { name: /team/ })
  await expect(trigger).toHaveAttribute('title', /You are not the owner of team in Admin/, {
    timeout: 60_000,
  })
  // beside Open, which says why it cannot open there
  await expect(viewPage.locator('[data-action="open-view"]')).toBeDisabled()
  await expect(viewPage.locator('[data-open-blocker]')).toHaveText(
    'You are not the owner of team in Admin (Not owner). Its Views cannot be opened in Studio.',
  )
  await expect(page.locator('header').getByRole('button', { name: /team/ })).toHaveCount(0)
  await trigger.click()

  await expect(page.getByRole('alert').filter({ hasText: 'not the owner of team' })).toBeVisible()
  const list = page.getByRole('dialog')
  const pick = (name: string) => list.getByRole('button', { name: new RegExp(`^${name}\\b`) })
  await expect(pick('team')).toBeDisabled()
  await expect(pick('dev')).toBeDisabled()
  // The reason is a greyed warning beside the row, explained on hover.
  await expect(list.getByText('Not an Admin instance')).toHaveCount(0)
  await list.getByRole('button', { name: /^Not an Admin instance:/ }).hover()
  const why = page.getByText(/so it cannot switch to dev/)
  await expect(why).toBeVisible()
  await expect(why.locator('..')).toContainText('Not an Admin instance')
  await page.mouse.move(0, 400)
  await expect(why).toBeHidden()
  await expect(pick('mine')).toBeEnabled()

  await pick('dev').click({ force: true })
  expect(switched).toEqual([])
  await pick('mine').click()
  await expect.poll(() => switched).toEqual(['mine'])
})
