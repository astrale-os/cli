import { afterEach, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { StudioEvent } from '../../shared/contracts/runtime'

import { handleApi } from '../api'
import { disposeTestDomains, testDomain } from '../test-domain'

afterEach(() => {
  disposeTestDomains()
  told = []
})

/** What the routes told every window, in order. */
let told: StudioEvent[] = []

async function route(path: string, init?: RequestInit) {
  const url = new URL(`http://127.0.0.1${path}`)
  return handleApi(new Request(url, init), url, (event) => told.push(event))
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const scenario = {
  id: 'who-runs',
  dataset: './tests/datasets/support-desk.ts',
  name: 'Who settles an invoice',
  steps: [
    {
      id: 'one',
      as: 'ann',
      does: 'call',
      fn: 'Invoice.settle',
      on: { node: 'invoice-1' },
      expect: 'refused',
    },
  ],
}

test('Scenarios are read, put whole and deleted through one route', async () => {
  const handle = testDomain()
  const base = `/api/domain/${encodeURIComponent(handle.id)}/scenarios`
  expect(await (await route(base))?.json()).toEqual({ scenarios: [], revisions: {} })

  const put = await route(base, post({ action: 'put', scenario, revision: 0 }))
  expect(put?.status).toBe(200)
  expect(await put?.json()).toEqual({ scenarios: [scenario], revisions: { 'who-runs': 1 } })
  expect(existsSync(join(handle.root, '.domain-studio', 'scenarios.json'))).toBe(true)

  const flipped = { ...scenario, steps: [{ ...scenario.steps[0], expect: 'allowed' }] }
  await route(base, post({ action: 'put', scenario: flipped, revision: 1 }))
  expect(await (await route(base))?.json()).toEqual({
    scenarios: [flipped],
    revisions: { 'who-runs': 2 },
  })

  const deleted = await route(base, post({ action: 'delete', id: 'who-runs', revision: 2 }))
  expect(await deleted?.json()).toEqual({ scenarios: [], revisions: {} })

  // each write that lands is told to every window, with the revisions it leaves; a read is not
  expect(told).toEqual([
    { type: 'scenarios', domainId: handle.id, revisions: { 'who-runs': 1 } },
    { type: 'scenarios', domainId: handle.id, revisions: { 'who-runs': 2 } },
    { type: 'scenarios', domainId: handle.id, revisions: {} },
  ])
  // and one refused, or a delete of one already gone, is told to none
  await route(base, post({ action: 'delete', id: 'who-runs', revision: 7 }))
  await route(base, post({ action: 'put', scenario: { ...scenario, name: '' }, revision: 0 }))
  expect(told).toHaveLength(3)
})

test('two tabs do not undo each other: a write from an older revision is refused with 409', async () => {
  const handle = testDomain()
  const base = `/api/domain/${encodeURIComponent(handle.id)}/scenarios`
  await route(base, post({ action: 'put', scenario, revision: 0 }))
  const renamed = { ...scenario, name: 'Renamed in the second tab' }
  await route(base, post({ action: 'put', scenario: renamed, revision: 1 }))

  const stale = await route(base, post({ action: 'put', scenario, revision: 1 }))
  expect(stale?.status).toBe(409)
  expect(await stale?.json()).toEqual({
    error: 'Scenario who-runs changed elsewhere (revision 2, this was made from 1).',
    stale: true,
  })
  const staleDelete = await route(base, post({ action: 'delete', id: 'who-runs', revision: 1 }))
  expect(staleDelete?.status).toBe(409)
  expect((await (await route(base))?.json()).scenarios).toEqual([renamed])

  const unnamed = await route(base, post({ action: 'put', scenario }))
  expect(unnamed?.status).toBe(400)
  expect(await unnamed?.json()).toEqual({
    error: 'a write names the revision it was made from: 0 for a new Scenario',
  })
})

test('a Scenarios file not read whole is said by the read and refused to every write', async () => {
  const handle = testDomain()
  const base = `/api/domain/${encodeURIComponent(handle.id)}/scenarios`
  const path = join(handle.root, '.domain-studio', 'scenarios.json')
  await route(base, post({ action: 'put', scenario, revision: 0 }))
  writeFileSync(path, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n')
  const unreadable = {
    error: `${path} cannot be read whole: it holds an unresolved merge conflict. The Studio leaves it as it is; fix it, then read again.`,
    unreadable: { path, reason: 'it holds an unresolved merge conflict' },
  }
  const read = await route(base)
  expect(read?.status).toBe(409)
  expect(await read?.json()).toEqual(unreadable)
  const write = await route(base, post({ action: 'put', scenario, revision: 1 }))
  expect(write?.status).toBe(409)
  expect(await write?.json()).toEqual(unreadable)
})

test('the Scenarios route refuses what does not decode, and changes nothing', async () => {
  const handle = testDomain()
  const base = `/api/domain/${encodeURIComponent(handle.id)}/scenarios`
  await route(base, post({ action: 'put', scenario, revision: 0 }))

  const unknown = await route(base, post({ action: 'rename' }))
  expect(unknown?.status).toBe(400)
  expect(await unknown?.json()).toEqual({ error: 'unknown Scenario action' })

  const broken = await route(
    base,
    post({
      action: 'put',
      revision: 1,
      scenario: { ...scenario, steps: [{ ...scenario.steps[0], fn: '' }] },
    }),
  )
  expect(broken?.status).toBe(400)
  expect(await broken?.json()).toEqual({ error: 'step 1 calls a function by its handler key' })

  const nameless = await route(base, post({ action: 'delete', revision: 1 }))
  expect(await nameless?.json()).toEqual({ error: 'a delete names the Scenario by its id' })
  expect((await route(base, { method: 'PUT' }))?.status).toBe(400)
  expect((await (await route(base))?.json()).scenarios).toEqual([scenario])
})
