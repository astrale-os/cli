import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphQueryApi } from '../../graph'

import { adminSession } from '../../__tests__/fixture'
import { AdminContract } from '../../contract'
import { connectAdminInstances } from '../client'

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the promise to reject.')
}

function fixture(input: {
  instances?: readonly Node[]
  listOutput?: unknown
  useDefaultOperationIds?: boolean
  operationId?: (
    kind: 'create' | 'status' | 'delete' | 'install-domain' | 'invite' | 'reconcile-invitation',
  ) => string
  invoke?: (target: string, input: unknown) => unknown
  query?: (
    ast: QueryAST,
    options: Readonly<{ page: Readonly<{ size: number; after?: string }> }>,
  ) => unknown
  queryResult?: unknown
}) {
  const calls: Array<{
    target: string
    value: unknown
  }> = []
  const listCalls: Array<{
    target: string
    value: unknown
  }> = []
  const remote = adminSession((target, value) => {
    if (target === '/:admin.astrale.ai:core.fleet::listInstances') {
      listCalls.push({ target, value })
      if (input.listOutput !== undefined) return input.listOutput
      const includeRetired =
        typeof value === 'object' &&
        value !== null &&
        (value as { includeRetired?: unknown }).includeRetired === true
      return (input.instances ?? [])
        .map(instanceSummaryFromNode)
        .filter((instance) => includeRetired || instance.state !== 'deleted')
    }
    calls.push({ target, value })
    return input.invoke?.(target, value)
  })
  const query = mock(
    async (
      ast: QueryAST,
      options: Readonly<{ page: Readonly<{ size: number; after?: string }> }>,
    ) =>
      input.query !== undefined
        ? input.query(ast, options)
        : input.queryResult === undefined
          ? {
              result: {
                kind: 'nodes' as const,
                nodes: (input.instances ?? []).map((value) => ({ kind: 'value' as const, value })),
              },
              page: {},
            }
          : input.queryResult,
  )
  const graph = { query } as unknown as AdminGraphQueryApi
  return {
    call: remote.call,
    reflection: remote.reflection,
    query,
    calls,
    listCalls,
    connect: () =>
      connectAdminInstances(
        { session: remote.session, graph },
        input.useDefaultOperationIds
          ? undefined
          : { operationId: input.operationId ?? ((kind) => `cli.instance.${kind}.test`) },
      ),
  }
}

describe('V2 Admin Instance adapter', () => {
  test('lists caller-visible Instances through the one Fleet inventory Method', async () => {
    const contract = fixture({
      instances: [
        instanceNode(),
        instanceNode({
          id: 'deleted',
          slug: 'retired',
          state: 'deleted',
          issuer: 'https://retired.example.test/kernel/host',
        }),
      ],
    })
    const api = await contract.connect()

    await expect(api.list()).resolves.toEqual([
      {
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ])
    await api.list({ includeRetired: false })
    await expect(api.list({ includeRetired: true })).resolves.toEqual([
      {
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
      {
        id: '@deleted',
        slug: 'retired',
        url: 'https://demo.eu.astrale.ai',
        issuer: 'https://retired.example.test/kernel/host',
        state: 'deleted',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ])
    expect(contract.listCalls).toEqual([
      {
        target: '/:admin.astrale.ai:core.fleet::listInstances',
        value: {},
      },
      {
        target: '/:admin.astrale.ai:core.fleet::listInstances',
        value: {},
      },
      {
        target: '/:admin.astrale.ai:core.fleet::listInstances',
        value: { includeRetired: true },
      },
    ])
    expect(contract.calls).toEqual([])
    expect(contract.query).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('delegates default placement to Fleet without reading Host inventory', async () => {
    const created = {
      id: '@instance-node',
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'ready',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    }
    const contract = fixture({ invoke: () => created })

    await expect((await contract.connect()).create('demo')).resolves.toMatchObject({
      id: created.id,
      slug: created.slug,
      url: created.url,
      state: created.state,
      createdAt: created.createdAt,
    })
    expect(contract.calls).toEqual([
      {
        target: '/:admin.astrale.ai:core.fleet::createInstance',
        value: { operationId: 'cli.instance.create.test', slug: 'demo' },
      },
    ])
  })

  test('uses a protocol-safe generated operation id on the default adapter path', async () => {
    const created = {
      id: '@instance-node',
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'ready',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    }
    const contract = fixture({ useDefaultOperationIds: true, invoke: () => created })

    await (await contract.connect()).create('demo')

    expect(contract.calls[0]?.value).toMatchObject({
      operationId: expect.stringMatching(
        /^cli\.instance\.create\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    })
  })

  test('refreshes and deletes through the resolved Instance receiver', async () => {
    const contract = fixture({
      instances: [instanceNode()],
      invoke: (target) => ({
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: target.endsWith('::delete') ? 'deleted' : 'ready',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      }),
    })
    const api = await contract.connect()

    await expect(api.status('demo')).resolves.toMatchObject({ state: 'ready' })
    await expect(api.delete('@instance-node')).resolves.toMatchObject({ state: 'deleted' })
    expect(contract.calls).toEqual([
      {
        target: '@instance-node::status',
        value: { operationId: 'cli.instance.status.test' },
      },
      {
        target: '@instance-node::delete',
        value: { operationId: 'cli.instance.delete.test' },
      },
    ])
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('retries terminal deletion through the exact NodePath while public inventory stays empty', async () => {
    const deleted = instanceNode({ state: 'deleted' })
    let attempts = 0
    let queries = 0
    const contract = fixture({
      instances: [deleted],
      useDefaultOperationIds: true,
      query: (ast, options) => {
        queries += 1
        expect(JSON.parse(JSON.stringify(ast))).toEqual({
          format: 'astrale.graph.query',
          version: 'v6',
          source: {
            kind: 'node',
            terms: [{ kind: 'path', path: '@instance-node' }],
            binding: 'n0',
          },
          steps: [
            {
              op: 'filter',
              binding: 'n0',
              predicate: {
                kind: 'class.equal',
                class: { origin: 'admin.astrale.ai', kind: 'class', name: 'Instance' },
              },
            },
          ],
          select: { kind: 'nodes', binding: 'n0', projection: { kind: 'value' } },
        })
        expect(options).toEqual({ page: { size: 1 } })
        return {
          result: {
            kind: 'nodes' as const,
            nodes: [{ kind: 'value' as const, value: deleted }],
          },
          page: {},
        }
      },
      invoke: () => {
        attempts += 1
        if (attempts === 1) throw new Error('response lost after terminal commit')
        return {
          id: '@instance-node',
          slug: 'demo',
          state: 'deleted',
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:00.000Z',
        }
      },
    })
    const api = await contract.connect()

    await expect(api.list()).resolves.toEqual([])
    await expect(api.delete('@instance-node')).rejects.toThrow(
      'response lost after terminal commit',
    )
    await expect(api.delete('@instance-node')).resolves.toMatchObject({ state: 'deleted' })
    expect(contract.calls.map(({ target }) => target)).toEqual([
      '@instance-node::delete',
      '@instance-node::delete',
    ])
    expect(queries).toBe(2)
    const operationIds = contract.calls.map(({ value }) =>
      String((value as { operationId: unknown }).operationId),
    )
    expect(operationIds).toHaveLength(2)
    expect(operationIds[0]).toMatch(
      /^cli\.instance\.delete\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(operationIds[1]).toMatch(
      /^cli\.instance\.delete\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(operationIds[0]).not.toBe(operationIds[1])
  })

  test('installs a resolved catalog Domain through Instance.installDomain', async () => {
    const contract = fixture({
      instances: [instanceNode()],
      invoke: () => ({
        domain: '@crm-domain',
        instance: '@instance-node',
        origin: 'crm.acme.dev',
        ok: true,
        installedRevision: `sha256:${'a'.repeat(64)}`,
      }),
    })
    const api = await contract.connect()

    await expect(api.installDomain('demo', '@crm-domain')).resolves.toMatchObject({
      domain: '@crm-domain',
      instance: '@instance-node',
      origin: 'crm.acme.dev',
      ok: true,
    })
    expect(contract.calls.at(-1)).toEqual({
      target: '@instance-node::installDomain',
      value: { operationId: 'cli.instance.install-domain.test', domain: '@crm-domain' },
    })
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('invites through the exact Instance receiver and observes before explicit recovery', async () => {
    const summary = {
      id: '@invitation-node',
      email: 'person@example.com',
      state: 'pending',
      access: 'member',
      instance: '@instance-node',
      invitedBy: '@owner',
      createdAt: '2026-08-28T10:00:00.000Z',
    } as const
    const contract = fixture({ instances: [instanceNode()], invoke: () => summary })
    const api = await contract.connect()

    await expect(api.invite('demo', 'Person@Example.com', 7)).resolves.toEqual(summary)
    await expect(api.statusInvitation('@invitation-node')).resolves.toEqual(summary)
    await expect(api.reconcileInvitation('@invitation-node')).resolves.toEqual(summary)
    expect(contract.calls).toEqual([
      {
        target: '@instance-node::inviteUser',
        value: {
          operationId: 'cli.instance.invite.test',
          email: 'Person@Example.com',
          expiresInDays: 7,
        },
      },
      {
        target: '@invitation-node::status',
        value: {},
      },
      {
        target: '@invitation-node::reconcile',
        value: { operationId: 'cli.instance.reconcile-invitation.test' },
      },
    ])
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test.each([
    ['Invitation id', { id: '@other-invitation' }],
    ['missing Instance', { instance: undefined }],
    ['Fleet access', { access: 'administrator' }],
  ] as const)('rejects status with mismatched %s scope', async (_label, mismatch) => {
    const contract = fixture({
      invoke: () => ({
        id: '@invitation-node',
        email: 'person@example.com',
        state: 'pending',
        access: 'member',
        instance: '@instance-node',
        createdAt: '2026-08-28T10:00:00.000Z',
        ...mismatch,
      }),
    })

    const error = await captureRejection(
      (await contract.connect()).statusInvitation('@invitation-node'),
    )
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toBe(
      'Admin Invitation status does not match its requested scope.',
    )
  })

  test('status is one read-only direct call and rejects a callable receiver before I/O', async () => {
    const summary = {
      id: '@invitation-node',
      email: 'person@example.com',
      state: 'pending',
      access: 'member',
      instance: '@instance-node',
      createdAt: '2026-08-28T10:00:00.000Z',
    } as const
    const operationId = mock(() => 'must-not-be-called')
    const contract = fixture({ operationId, invoke: () => summary })
    const api = await contract.connect()

    await expect(api.statusInvitation('@invitation-node')).resolves.toEqual(summary)
    expect(contract.calls).toEqual([{ target: '@invitation-node::status', value: {} }])
    expect(contract.query).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()
    expect(operationId).not.toHaveBeenCalled()

    contract.calls.length = 0
    const error = await captureRejection(api.statusInvitation('@invitation-node::status'))
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toBe('Admin Invitation id is invalid.')
    expect(contract.calls).toEqual([])
  })

  test('uses fresh production operation IDs for invite and reconciliation', async () => {
    const summary = {
      id: '@invitation-node',
      email: 'person@example.com',
      state: 'pending',
      access: 'member',
      instance: '@instance-node',
      createdAt: '2026-08-28T10:00:00.000Z',
    } as const
    const contract = fixture({
      instances: [instanceNode()],
      useDefaultOperationIds: true,
      invoke: () => summary,
    })
    const api = await contract.connect()

    await api.invite('demo', 'person@example.com')
    await api.reconcileInvitation('@invitation-node')
    await api.reconcileInvitation('@invitation-node')

    const operationIds = contract.calls.map(({ value }) =>
      String((value as { operationId: unknown }).operationId),
    )
    expect(operationIds[0]).toMatch(
      /^cli\.instance\.invite\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(operationIds[1]).toMatch(
      /^cli\.instance\.reconcile-invitation\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(operationIds[2]).toMatch(
      /^cli\.instance\.reconcile-invitation\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(operationIds[0]).not.toBe(operationIds[1])
    expect(operationIds[1]).not.toBe(operationIds[2])
  })

  test.each([
    ['Instance', { instance: '@another-instance' }],
    ['access', { access: 'administrator' }],
    ['email', { email: 'another@example.com' }],
  ] as const)(
    'rejects an invitation response with mismatched %s scope',
    async (_label, mismatch) => {
      const contract = fixture({
        instances: [instanceNode()],
        invoke: () => ({
          id: '@invitation-node',
          email: 'person@example.com',
          state: 'pending',
          access: 'member',
          instance: '@instance-node',
          createdAt: '2026-08-28T10:00:00.000Z',
          ...mismatch,
        }),
      })

      await expect((await contract.connect()).invite('demo', 'person@example.com')).rejects.toThrow(
        'Admin Instance invitation does not match its requested scope.',
      )
    },
  )

  test.each([
    ['Invitation id', { id: '@other-invitation' }],
    ['missing Instance', { instance: undefined }],
    ['Fleet access', { access: 'administrator' }],
  ] as const)('rejects reconciliation with mismatched %s scope', async (_label, mismatch) => {
    const contract = fixture({
      invoke: () => ({
        id: '@invitation-node',
        email: 'person@example.com',
        state: 'pending',
        access: 'member',
        instance: '@instance-node',
        createdAt: '2026-08-28T10:00:00.000Z',
        ...mismatch,
      }),
    })

    await expect(
      (await contract.connect()).reconcileInvitation('@invitation-node'),
    ).rejects.toThrow('Admin Invitation reconciliation does not match its requested scope.')
  })

  test('connects without network I/O and list performs exactly one Fleet call', async () => {
    const contract = fixture({})

    const api = await contract.connect()
    expect(contract.call).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()

    await expect(api.list()).resolves.toEqual([])
    expect(contract.listCalls).toEqual([
      { target: '/:admin.astrale.ai:core.fleet::listInstances', value: {} },
    ])
    expect(contract.query).not.toHaveBeenCalled()
    expect(contract.call).toHaveBeenCalledTimes(1)
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('rejects malformed inventory, Method, and install outputs', async () => {
    await expect(
      (
        await fixture({
          listOutput: {},
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance inventory is invalid.')
    await expect(
      (
        await fixture({
          listOutput: [instanceSummaryFromNode(instanceNode({ state: 'mystery' }))],
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance state is invalid.')
    await expect(
      (
        await fixture({
          listOutput: [
            {
              ...instanceSummaryFromNode(instanceNode()),
              issuer: 'not-an-issuer',
            },
          ],
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance issuer is invalid.')

    const malformedStatus = fixture({
      instances: [instanceNode()],
      invoke: () => ({
        id: '@instance-node',
        slug: 'demo',
        state: 'ready',
        failure: {},
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      }),
    })
    await expect((await malformedStatus.connect()).status('demo')).rejects.toThrow(
      'Admin failure message is invalid.',
    )

    const malformedInstall = fixture({
      instances: [instanceNode()],
      invoke: () => ({
        domain: '@crm-domain',
        instance: '@instance-node',
        origin: 'crm.acme.dev',
        ok: 'yes',
      }),
    })
    await expect(
      (await malformedInstall.connect()).installDomain('demo', '@crm-domain'),
    ).rejects.toThrow('Admin Domain install outcome is invalid.')

    const malformedInstallPath = fixture({
      instances: [instanceNode()],
      invoke: () => ({
        domain: 'not-a-path',
        instance: '@instance-node',
        origin: 'crm.acme.dev',
        ok: true,
      }),
    })
    await expect(
      (await malformedInstallPath.connect()).installDomain('demo', '@crm-domain'),
    ).rejects.toThrow('Admin Domain reference is invalid.')

    const malformedInvitation = fixture({
      instances: [instanceNode()],
      invoke: () => ({
        id: '@invitation-node',
        email: 'person@example.com',
        state: 'unknown',
        access: 'member',
        instance: '@instance-node',
        createdAt: '2026-08-28T10:00:00.000Z',
      }),
    })
    await expect(
      (await malformedInvitation.connect()).invite('demo', 'person@example.com'),
    ).rejects.toThrow('Admin Invitation state is invalid.')
  })
})

function instanceNode(
  input: Readonly<{
    id?: string
    class?: Node['class']
    slug?: unknown
    url?: unknown
    issuer?: unknown
    organizationId?: unknown
    state?: unknown
    phase?: unknown
    failure?: unknown
    createdAt?: unknown
    updatedAt?: unknown
  }> = {},
): Node {
  const property = AdminContract.properties.instance
  const properties: Record<string, unknown> = {
    [property.slug]: input.slug ?? 'demo',
    [property.url]: input.url ?? 'https://demo.eu.astrale.ai',
    [property.state]: input.state ?? 'ready',
    [property.createdAt]: input.createdAt ?? '2026-08-12T00:00:00.000Z',
    [property.updatedAt]: input.updatedAt ?? '2026-08-12T00:00:00.000Z',
  }
  if (input.organizationId !== undefined) {
    properties[property.organizationId] = input.organizationId
  }
  if (input.issuer !== undefined) properties[property.issuer] = input.issuer
  if (input.phase !== undefined) properties[property.phase] = input.phase
  if (input.failure !== undefined) properties[property.failure] = input.failure
  return Object.freeze({
    id: NodeId(input.id ?? 'instance-node'),
    class: input.class ?? ClassKey.of(AdminContract.classes.Instance),
    props: normalizeProperties(properties),
  })
}

function instanceSummaryFromNode(node: Node): Record<string, unknown> {
  const property = AdminContract.properties.instance
  return {
    id: `@${node.id}`,
    slug: node.props[property.slug],
    url: node.props[property.url],
    ...(node.props[property.issuer] === undefined ? {} : { issuer: node.props[property.issuer] }),
    state: node.props[property.state],
    ...(node.props[property.phase] === undefined ? {} : { phase: node.props[property.phase] }),
    ...(node.props[property.failure] === undefined
      ? {}
      : { failure: node.props[property.failure] }),
    createdAt: node.props[property.createdAt],
    updatedAt: node.props[property.updatedAt],
    ...(node.props[property.organizationId] === undefined
      ? {}
      : { organizationId: node.props[property.organizationId] }),
  }
}
