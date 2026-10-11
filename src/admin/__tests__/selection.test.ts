import { ClassKey } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { K, PropertyKey } from '@astrale-os/sdk/schema'
import { expect, mock, test } from 'bun:test'

import type { AdminGraphQueryApi } from '../graph'

import { AdminContract } from '../contract'
import { connectAdminInstances } from '../instance/client'
import { resolveAdminFleet } from '../selection'
import { adminSession } from './fixture'

function fixture(entries: Entries, explicit?: string) {
  const nodes = entries.map(([slug]) => ({
    id: NodeId(slug),
    class: ClassKey.of(AdminContract.classes.Fleet),
    props: normalizeProperties({
      [PropertyKey.of(AdminContract.classes.Fleet, 'slug')]: slug,
      [K.classes.Named.properties.name.key]: slug,
    }),
  }))
  const query = mock(async () => ({
    result: {
      kind: 'nodes' as const,
      nodes: nodes.map((value) => ({ kind: 'value' as const, value })),
    },
    page: {},
  }))
  const remote = adminSession((target, input) => {
    if (target.endsWith(':class.Identity:can')) {
      expect(input).toMatchObject({ policy: '/:admin.astrale.ai:policy.UseFleet' })
      return {
        allowed: entries.find(([id]) => id === (input as { object: string }).object)?.[1] ?? false,
      }
    }
    if (target.endsWith('.method.createInstance'))
      return { id: '@created', slug: 'demo', state: 'ready', url: 'https://demo.test' }
    throw new Error(`Unexpected call: ${target}`)
  })
  return {
    context: {
      fleet: explicit,
      graph: { query } as unknown as AdminGraphQueryApi,
      session: remote.session,
    },
    query,
    remote,
  }
}

type Entries = [string, boolean][]

test.each([
  [[['shared', true]]],
  [
    [
      ['default', false],
      ['shared', true],
    ],
  ],
  [
    [
      ['observer-only', false],
      ['shared', true],
    ],
  ],
] as [Entries][])(
  'selects the one Fleet the native UseFleet decision allows (%j)',
  async (entries) => {
    expect(String((await resolveAdminFleet(fixture(entries).context)).raw)).toBe('@shared')
  },
)

test.each([
  [[]],
  [
    [
      ['default', true],
      ['shared', true],
    ],
  ],
  [[['shared', false]]],
  [
    [
      ['shared', true],
      ['astrale', true],
    ],
  ],
] as [Entries][])(
  'refuses absence or ambiguity without choosing a default (%j)',
  async (entries) => {
    await expect(resolveAdminFleet(fixture(entries).context)).rejects.toThrow(/No Fleet|Choose one/)
  },
)

test('an explicit receiver bypasses selection, not the callable policy', async () => {
  const { context, query, remote } = fixture([], '@chosen')
  expect((await resolveAdminFleet(context)).raw).toEqual(expect.stringMatching(/^@chosen$/))
  expect(query).not.toHaveBeenCalled()
  expect(remote.call).not.toHaveBeenCalled()
})

test('never selects a Fleet the caller may only observe', async () => {
  const { context } = fixture([['client', false]])
  await expect(resolveAdminFleet(context)).rejects.toThrow('No Fleet')
})

test('the instance client creates in its sole usable Fleet', async () => {
  const { context, remote } = fixture([['shared', true]])
  const api = await connectAdminInstances(context)
  await expect(api.create('demo', 'create-shared')).resolves.toMatchObject({ id: '@created' })
  expect(JSON.stringify(remote.call.mock.calls)).toContain(
    '@shared::admin.astrale.ai:class.Fleet.method.createInstance',
  )
})

test('lists the usable choices and never creates when default is one of several', async () => {
  const { context, remote } = fixture([
    ['default', true],
    ['shared', true],
    ['observer', false],
  ])
  const api = await connectAdminInstances(context)
  await expect(api.create('demo')).rejects.toMatchObject({
    code: 'FLEET_SELECTION_REQUIRED',
    hint: 'Pass --fleet with one of: default (@default), shared (@shared).',
  })
  expect(
    remote.call.mock.calls.every(([request]) =>
      String(request.target).endsWith(':class.Identity:can'),
    ),
  ).toBe(true)
})

test('checks subsequent pages before automatically selecting a Fleet', async () => {
  const { context, query } = fixture([
    ['default', true],
    ['shared', true],
  ])
  const all = await query()
  query.mockClear()
  query.mockResolvedValueOnce({
    ...all,
    result: { ...all.result, nodes: all.result.nodes.slice(0, 1) },
    page: { next: 'second' },
  })
  query.mockResolvedValueOnce({
    ...all,
    result: { ...all.result, nodes: all.result.nodes.slice(1) },
  })
  await expect(resolveAdminFleet(context)).rejects.toMatchObject({
    code: 'FLEET_SELECTION_REQUIRED',
  })
  expect(query).toHaveBeenCalledTimes(2)
})

test('bounds concurrent native policy probes without rereading the directory', async () => {
  const { context, query, remote } = fixture(
    Array.from({ length: 19 }, (_, i) => [`fleet-${i}`, false]),
  )
  let inFlight = 0
  let peak = 0
  remote.call.mockImplementation(async () => {
    peak = Math.max(peak, ++inFlight)
    await new Promise((resolve) => setTimeout(resolve, 1))
    --inFlight
    return { allowed: false }
  })
  await expect(resolveAdminFleet(context)).rejects.toMatchObject({
    code: 'FLEET_UNAVAILABLE',
  })
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(8)
  expect(remote.call).toHaveBeenCalledTimes(19)
  expect(query).toHaveBeenCalledTimes(1)
})
