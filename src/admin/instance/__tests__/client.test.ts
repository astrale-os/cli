import type { Node } from '@astrale-os/sdk/graph/node'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphQueryApi } from '../../graph'

import { adminSession } from '../../__tests__/fixture'
import { AdminContract } from '../../contract'
import { connectAdminInstances } from '../client'

const INSTANCE = '@instance-node::admin.astrale.ai:class.Instance.method'
const FLEET = '@customer-fleet::admin.astrale.ai:class.Fleet.method'
const CREATED_AT = '2026-08-12T00:00:00.000Z'
const INVITATION = {
  id: '@invitation-node',
  email: 'person@example.com',
  state: 'pending',
  access: 'member',
  instance: '@instance-node',
  createdAt: CREATED_AT,
} as const

/** A generated operation id of one kind: fresh per request, never a constant. */
const generated = (kind: string) =>
  expect.stringMatching(new RegExp(`^cli\\.instance\\.${kind}\\.[0-9a-f-]{36}$`, 'u'))

/** An Admin whose graph holds `instances` and whose Methods answer `invoke`. */
function admin(
  input: {
    fleet?: string
    instances?: readonly Node[]
    invoke?: (target: string, input: unknown) => unknown
  } = {},
) {
  const calls: Array<{ target: string; value: unknown }> = []
  const remote = adminSession((target, value) => {
    calls.push({ target, value })
    if (target === `${FLEET}.listInstances` && input.invoke === undefined) {
      return (input.instances ?? []).map(summary)
    }
    return input.invoke?.(target, value)
  })
  const query = mock(async (_ast: unknown, _options: unknown) => ({
    result: {
      kind: 'nodes' as const,
      nodes: (input.instances ?? []).map((value) => ({ kind: 'value' as const, value })),
    },
    page: {},
  }))
  return {
    calls,
    query,
    connect: () =>
      connectAdminInstances({
        session: remote.session,
        graph: { query } as unknown as AdminGraphQueryApi,
        fleet: input.fleet ?? '@customer-fleet',
      }),
  }
}

describe('Admin Instance adapter', () => {
  test('lists, creates and replays through the selected Fleet without reading its directory', async () => {
    const created = summary(instance())
    const fixture = admin({
      invoke: (target) => (target.endsWith('.listInstances') ? [created] : created),
    })
    const api = await fixture.connect()
    await expect(api.list({ includeRetired: true })).resolves.toEqual([
      {
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ])
    await api.create('demo')
    await api.create('demo', 'cli.instance.create.retained')
    expect(fixture.calls).toEqual([
      { target: `${FLEET}.listInstances`, value: { includeRetired: true } },
      {
        target: `${FLEET}.createInstance`,
        value: { operationId: generated('create'), slug: 'demo' },
      },
      {
        target: `${FLEET}.createInstance`,
        value: { operationId: 'cli.instance.create.retained', slug: 'demo' },
      },
    ])
    expect(fixture.query).not.toHaveBeenCalled()
  })

  test('refuses a Fleet that is no Node path before any I/O', async () => {
    for (const fleet of ['astrale', '']) {
      const fixture = admin({ fleet })
      await expect(fixture.connect()).rejects.toThrow()
      expect(fixture.calls).toEqual([])
    }
  })

  test('resolves a slug or a Node id to the exact Instance receiver of each Method', async () => {
    const node = instance()
    const fixture = admin({
      instances: [node],
      invoke: (target) => ({
        ...summary(node),
        state: target.endsWith('.delete') ? 'deleted' : 'ready',
      }),
    })
    const api = await fixture.connect()
    await expect(api.status('demo')).resolves.toMatchObject({ state: 'ready' })
    await expect(api.delete('@instance-node')).resolves.toMatchObject({ state: 'deleted' })
    expect(fixture.query.mock.calls.map(([ast]) => JSON.parse(JSON.stringify(ast)))).toMatchObject([
      { steps: [{ op: 'filter', predicate: { value: 'demo' } }] },
      {
        source: { terms: [{ kind: 'path', path: '@instance-node' }] },
        steps: [{ op: 'filter', predicate: { kind: 'class.equal' } }],
      },
    ])
    expect(fixture.calls).toEqual([
      { target: `${INSTANCE}.status`, value: { operationId: generated('status') } },
      { target: `${INSTANCE}.delete`, value: { operationId: generated('delete') } },
    ])
  })

  test('retries a terminal deletion through its Node id with a fresh operation id', async () => {
    let attempts = 0
    const fixture = admin({
      instances: [instance({ state: 'deleted' })],
      invoke: (target) => {
        if (target.endsWith('.listInstances')) return []
        attempts += 1
        if (attempts === 1) throw new Error('response lost after terminal commit')
        return summary(instance({ state: 'deleted' }))
      },
    })
    const api = await fixture.connect()
    await expect(api.list()).resolves.toEqual([])
    await expect(api.delete('@instance-node')).rejects.toThrow('response lost')
    await expect(api.delete('@instance-node')).resolves.toMatchObject({ state: 'deleted' })
    const [first, second] = fixture.calls.slice(1).map(({ value }) => value)
    expect(first).not.toEqual(second)
  })

  test('retrieves a root identity transfer scoped to the exact Instance and recipient', async () => {
    const recipient = {
      kty: 'EC',
      crv: 'P-256',
      x: 'x'.repeat(43),
      y: 'y'.repeat(43),
      kid: 'r'.repeat(43),
    } as const
    const transfer = (requestId: string) => ({
      format: 'astrale.instance-root-transfer',
      version: 1,
      requestId,
      instance: '@instance-node',
      issuer: 'https://demo.eu.astrale.ai',
      subject: 's'.repeat(43),
      recipientThumbprint: recipient.kid,
      jwe: 'a.b.c.d.e',
    })
    const fixture = admin({
      instances: [instance({ issuer: 'https://demo.eu.astrale.ai' })],
      invoke: (_target, value) => transfer((value as { requestId: string }).requestId),
    })
    const retrieved = await (await fixture.connect()).retrieveRootIdentity('demo', recipient)
    expect(retrieved.instance.id).toBe('@instance-node')
    expect(retrieved.transfer).toEqual(transfer(retrieved.transfer.requestId) as never)
    expect(fixture.calls).toEqual([
      {
        target: `${INSTANCE}.retrieveRootIdentity`,
        value: { requestId: generated('retrieve-root'), recipient },
      },
    ])
  })

  test('invites, observes and reconciles an Invitation, exposing its reserved Shell User', async () => {
    const fixture = admin({
      instances: [instance()],
      invoke: () => ({ ...INVITATION, target: { instance: 'instance-node', user: 'user-node' } }),
    })
    const api = await fixture.connect()
    const expected = { ...INVITATION, user: '@user-node' }
    await expect(api.invite('demo', 'Person@Example.com', 7)).resolves.toEqual(expected)
    await expect(api.statusInvitation('@invitation-node')).resolves.toEqual(expected)
    await expect(api.reconcileInvitation('@invitation-node')).resolves.toEqual(expected)
    expect(fixture.calls).toEqual([
      {
        target: `${INSTANCE}.inviteUser`,
        value: { operationId: generated('invite'), email: 'Person@Example.com', expiresInDays: 7 },
      },
      { target: '@invitation-node::admin.astrale.ai:class.Invitation.method.status', value: {} },
      {
        target: '@invitation-node::admin.astrale.ai:class.Invitation.method.reconcile',
        value: { operationId: generated('reconcile-invitation') },
      },
    ])
    await expect(
      api.statusInvitation('@invitation-node::admin.astrale.ai:class.Invitation.method.status'),
    ).rejects.toThrow('Admin Invitation id is invalid.')
  })

  test('observes every Invitation state exactly, never collapsing progress into completion', async () => {
    const states = [
      'pending',
      'accepted',
      'registering',
      'registered',
      'completed',
      'cancelled',
      'expired',
      'failed',
    ]
    for (const state of states) {
      const api = await admin({ invoke: () => ({ ...INVITATION, state }) }).connect()
      await expect(api.statusInvitation('@invitation-node')).resolves.toMatchObject({ state })
    }
  })

  test.each([
    ['another Invitation', { id: '@other-invitation' }],
    ['no Instance', { instance: undefined }],
    ['Fleet access', { access: 'administrator' }],
    ['another target Instance', { target: { instance: 'other-instance', user: 'user-node' } }],
  ] as const)('refuses an Invitation answer for %s', async (_label, mismatch) => {
    const api = await admin({ invoke: () => ({ ...INVITATION, ...mismatch }) }).connect()
    await expect(api.statusInvitation('@invitation-node')).rejects.toThrow(
      'Admin Invitation status does not match its requested scope.',
    )
  })

  test('refuses an invitation answer for another Instance or email', async () => {
    for (const mismatch of [{ instance: '@another-instance' }, { email: 'another@example.com' }]) {
      const api = await admin({
        instances: [instance()],
        invoke: () => ({ ...INVITATION, ...mismatch }),
      }).connect()
      await expect(api.invite('demo', 'person@example.com')).rejects.toThrow(
        'Admin Instance invitation does not match its requested scope.',
      )
    }
  })

  test('refuses malformed inventory and Method outputs', async () => {
    const list = (output: unknown) =>
      admin({ invoke: () => output })
        .connect()
        .then((api) => api.list())
    await expect(list({})).rejects.toThrow('Admin Instance inventory is invalid.')
    await expect(list([summary(instance({ state: 'mystery' }))])).rejects.toThrow(
      'Admin Instance state is invalid.',
    )
    await expect(list([{ ...summary(instance()), issuer: 'not-an-issuer' }])).rejects.toThrow(
      'Admin Instance issuer is invalid.',
    )
    const failed = admin({
      instances: [instance()],
      invoke: () => ({ ...summary(instance()), failure: {} }),
    })
    await expect((await failed.connect()).status('demo')).rejects.toThrow(
      'Admin failure message is invalid.',
    )
    const unknown = admin({
      instances: [instance()],
      invoke: () => ({ ...INVITATION, state: 'unknown' }),
    })
    await expect((await unknown.connect()).invite('demo', 'person@example.com')).rejects.toThrow(
      'Admin Invitation state is invalid.',
    )
  })
})

function instance(input: Readonly<{ state?: unknown; issuer?: unknown }> = {}): Node {
  const property = AdminContract.properties.instance
  return Object.freeze({
    id: NodeId('instance-node'),
    class: ClassKey.of(AdminContract.classes.Instance),
    props: normalizeProperties({
      [property.slug]: 'demo',
      [property.url]: 'https://demo.eu.astrale.ai',
      [property.state]: input.state ?? 'ready',
      [property.createdAt]: CREATED_AT,
      [property.updatedAt]: CREATED_AT,
      ...(input.issuer === undefined ? {} : { [property.issuer]: input.issuer }),
    }),
  })
}

/** The InstanceSummary Admin's Methods answer for one Instance Node. */
function summary(node: Node): Record<string, unknown> {
  const property = AdminContract.properties.instance
  return {
    id: `@${node.id}`,
    slug: node.props[property.slug],
    url: node.props[property.url],
    ...(node.props[property.issuer] === undefined ? {} : { issuer: node.props[property.issuer] }),
    state: node.props[property.state],
    createdAt: node.props[property.createdAt],
    updatedAt: node.props[property.updatedAt],
  }
}
