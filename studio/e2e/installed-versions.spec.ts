import type { InstanceDomains, InstancesState } from '@shared/contracts/workspace'

import { expect, test } from './test'

const instances: InstancesState = {
  active: 'mine',
  instances: [
    {
      name: 'mine',
      url: 'https://mine.eu.astrale.ai/api',
      active: true,
      kind: 'bookmark',
      owned: true,
    },
  ],
}

const installed: InstanceDomains = {
  ok: true,
  domains: [
    {
      origin: 'crm.studio-demo.astrale.ai',
      version: '1.4.0',
      name: '1.4.0',
      url: 'https://crm-1-4-0.services.eu.astrale.ai',
      available: '1.5.0',
    },
    { origin: 'issues.astrale.ai', version: '2.3.1', name: '2.3.1' },
  ],
}

test('the rail shows the version each Domain runs on the active instance, and its deployment on click', async ({
  page,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const asked: string[] = []
  await page.route('**/api/instances', (route) => route.fulfill({ json: instances }))
  await page.route('**/api/instances/domains?**', async (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('name') ?? '')
    await held
    await route.fulfill({ json: installed })
  })

  await page.goto('/')
  const crm = page.getByTitle(/^1\.4\.0 installed on mine \(1\.5\.0 available\)$/)
  await expect(page.locator('.animate-pulse').first()).toBeVisible()
  release()
  await expect(crm).toBeVisible()
  // The peer Domain is not installed there: nothing beside it.
  await expect(page.getByTitle(/installed on mine/)).toHaveCount(1)
  // Every row reads the same listing.
  expect(new Set(asked)).toEqual(new Set(['mine']))

  await crm.click()
  const card = page.getByRole('dialog')
  await expect(card.getByText('Installed on')).toBeVisible()
  await expect(card.getByText('mine', { exact: true })).toBeVisible()
  await expect(card.getByText('crm-1-4-0.services.eu.astrale.ai')).toBeVisible()
  await expect(card.getByTitle('1.5.0 is available')).toBeVisible()
  await expect(card.getByText('crm.studio-demo.astrale.ai')).toHaveCount(0)
})
