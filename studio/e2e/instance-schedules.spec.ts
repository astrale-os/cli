import type {
  InstanceDomains,
  InstanceSchedules,
  InstancesState,
  ScheduleStatus,
} from '@shared/contracts/workspace'

import { expect, test } from './test'

const ORIGIN = 'crm.studio-demo.astrale.ai'

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
  domains: [{ origin: ORIGIN, version: '1.4.0', name: '1.4.0' }],
}

const minutes = (count: number) => new Date(Date.now() + count * 60_000).toISOString()

function status(overrides: Partial<ScheduleStatus>): ScheduleStatus {
  return {
    declared: true,
    cron: '*/15 * * * *',
    timezone: 'UTC',
    overlap: 'skip',
    state: 'active',
    next: minutes(9),
    cursor: minutes(-6),
    lastExecution: 'exec-digest-1',
    missed: 0,
    skipped: 0,
    refused: 0,
    ...overrides,
  }
}

const schedules: InstanceSchedules = {
  ok: true,
  schedules: [
    {
      id: 'sched-sweep',
      name: 'nightly',
      callable: 'Ledger.sweep',
      call: `/:${ORIGIN}:class.Ledger:sweep`,
      input: { depth: 'full' },
      status: status({
        cron: '30 3 * * 0',
        timezone: 'Europe/Paris',
        state: 'paused',
        pausedAt: minutes(-120),
        skipped: 2,
      }),
    },
    {
      id: 'sched-digest',
      name: 'default',
      callable: 'digest',
      call: `/:${ORIGIN}:function.digest`,
      input: { audience: 'team' },
      status: status({}),
    },
  ],
}

test('the installed chip lists the Domain’s Schedules; pause, resume and run now act on one', async ({
  page,
}) => {
  const listed: string[] = []
  const posted: Record<string, unknown>[] = []
  await page.route('**/api/instances', (route) => route.fulfill({ json: instances }))
  await page.route('**/api/instances/domains?**', (route) => route.fulfill({ json: installed }))
  await page.route('**/api/instances/schedules**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      const url = new URL(request.url())
      listed.push(`${url.searchParams.get('name')} ${url.searchParams.get('origin')}`)
      return route.fulfill({ json: schedules })
    }
    const body = request.postDataJSON() as Record<string, unknown>
    posted.push(body)
    if (body.action === 'run') return route.fulfill({ json: { ok: true, execution: 'exec-now-1' } })
    const state = body.action === 'pause' ? 'paused' : 'active'
    return route.fulfill({
      json: {
        ok: true,
        status: status({ state, ...(state === 'paused' ? { pausedAt: minutes(0) } : {}) }),
      },
    })
  })

  await page.goto('/')
  // Nothing is read until the popover opens: the listing spawns the CLI per Schedule.
  const chip = page.getByTitle(/^1\.4\.0 installed on mine$/)
  await expect(chip).toBeVisible()
  expect(listed).toEqual([])

  await chip.click()
  const card = page.getByRole('dialog')
  const section = card.getByRole('region', { name: 'Schedules' })
  await expect(section).toBeVisible()
  expect(listed).toEqual([`mine ${ORIGIN}`])

  const digest = section.locator('[data-schedule="sched-digest"]')
  const sweep = section.locator('[data-schedule="sched-sweep"]')
  await expect(digest.getByText('digest', { exact: true })).toBeVisible()
  await expect(digest.getByText('*/15 * * * * · UTC')).toBeVisible()
  await expect(digest.getByText('active', { exact: true })).toBeVisible()
  await expect(digest.getByText(/^in \d+ min$/)).toBeVisible()
  await expect(digest.getByText(/min ago/)).toBeVisible()
  await expect(sweep.getByText('Ledger.sweep/nightly')).toBeVisible()
  await expect(sweep.getByText('30 3 * * 0 · Europe/Paris')).toBeVisible()
  await expect(sweep.getByText(/^paused 2 h ago$/)).toBeVisible()
  await expect(sweep.getByText('2 skipped', { exact: false })).toBeVisible()

  // Pause one Schedule: only that row changes, from the status the Kernel answers.
  await digest.getByRole('button', { name: 'Pause' }).click()
  await expect(digest.getByText('paused', { exact: true })).toBeVisible()
  await expect(digest.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect(sweep.getByRole('button', { name: 'Resume' })).toBeVisible()
  expect(posted.at(-1)).toEqual({ name: 'mine', schedule: 'sched-digest', action: 'pause' })

  await sweep.getByRole('button', { name: 'Resume' }).click()
  await expect(sweep.getByText('active', { exact: true })).toBeVisible()
  await expect(sweep.getByRole('button', { name: 'Pause' })).toBeVisible()
  expect(posted.at(-1)).toEqual({ name: 'mine', schedule: 'sched-sweep', action: 'resume' })

  // Run now is an ordinary call of the callable with the Schedule's input.
  await sweep.getByRole('button', { name: 'Run now' }).click()
  await expect(page.getByText('Started Ledger.sweep/nightly (execution exec-now-1)')).toBeVisible()
  expect(posted.at(-1)).toEqual({
    name: 'mine',
    action: 'run',
    call: `/:${ORIGIN}:class.Ledger:sweep`,
    input: { depth: 'full' },
  })
})

test('a Domain without readable Schedules says so', async ({ page }) => {
  await page.route('**/api/instances', (route) => route.fulfill({ json: instances }))
  await page.route('**/api/instances/domains?**', (route) => route.fulfill({ json: installed }))
  await page.route('**/api/instances/schedules**', (route) =>
    route.fulfill({ json: { ok: false, schedules: [], error: 'RESPONSE_ERROR(2003)' } }),
  )

  await page.goto('/')
  await page.getByTitle(/^1\.4\.0 installed on mine$/).click()
  const section = page.getByRole('dialog').getByRole('region', { name: 'Schedules' })
  await expect(section.getByText('Schedules are not readable here.')).toBeVisible()
})
