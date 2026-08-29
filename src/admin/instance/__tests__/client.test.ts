import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphQueryApi } from '../../graph'
import type { InstanceLifecycleInfo } from '../model'

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
  const remote = adminSession((target, value) => {
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
  test('lists caller-visible Instances through one exact native graph Query', async () => {
    const contract = fixture({
      instances: [instanceNode(), instanceNode({ id: 'deleted', state: 'deleted' })],
    })

    await expect((await contract.connect()).list()).resolves.toEqual([
      {
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ])
    expect(contract.calls).toEqual([])
    expect(contract.query).toHaveBeenCalledWith(
      {
        format: 'astrale.graph.query',
        version: 'v6',
        source: {
          kind: 'node',
          terms: [
            {
              kind: 'class',
              class: { origin: 'admin.astrale.ai', kind: 'class', name: 'Instance' },
            },
          ],
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
        select: {
          kind: 'nodes',
          binding: 'n0',
          projection: { kind: 'value' },
          order: {
            property: 'admin.astrale.ai:class.Instance.property.state',
            direction: 'desc',
            unranked: 'last',
          },
        },
      },
      { page: { size: 256 } },
    )
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('reads administrator lifecycle evidence through one exact Fleet Method', async () => {
    const lifecycle: InstanceLifecycleInfo[] = [
      {
        slug: 'active',
        state: 'ready',
        lifecycle: 'active',
        issuer: 'https://active.example.test/kernel/host',
        updatedAt: '2026-08-29T08:00:00.000Z',
      },
      {
        slug: 'retired',
        state: 'deleted',
        lifecycle: 'retired',
        updatedAt: '2026-08-29T09:00:00.000Z',
      },
    ]
    const contract = fixture({ invoke: () => lifecycle })
    const api = await contract.connect()

    await expect(api.listLifecycle()).resolves.toEqual(lifecycle)
    await expect(api.listLifecycle({ includeRetired: true })).resolves.toEqual(lifecycle)
    expect(contract.calls).toEqual([
      {
        target: '/:admin.astrale.ai:core.fleet::listInstanceLifecycle',
        value: {},
      },
      {
        target: '/:admin.astrale.ai:core.fleet::listInstanceLifecycle',
        value: { includeRetired: true },
      },
    ])
    expect(contract.query).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test.each([
    ['non-array', {}],
    [
      'unknown classification',
      [
        {
          slug: 'demo',
          state: 'ready',
          lifecycle: 'unknown',
          updatedAt: '2026-08-29T08:00:00.000Z',
        },
      ],
    ],
    [
      'contradictory state',
      [
        {
          slug: 'demo',
          state: 'ready',
          lifecycle: 'retired',
          updatedAt: '2026-08-29T08:00:00.000Z',
        },
      ],
    ],
    [
      'invalid issuer',
      [
        {
          slug: 'demo',
          state: 'ready',
          lifecycle: 'active',
          issuer: 'not-an-issuer',
          updatedAt: '2026-08-29T08:00:00.000Z',
        },
      ],
    ],
  ])('rejects malformed lifecycle evidence: %s', async (_label, output) => {
    const contract = fixture({ invoke: () => output })
    await expect(
      (await contract.connect()).listLifecycle({ includeRetired: true }),
    ).rejects.toThrow(/lifecycle/u)
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
      useDefaultOperationIds: true,
      query: (ast, options) => {
        queries += 1
        if (queries === 1) {
          expect(ast.source.kind).toBe('node')
          if (ast.source.kind !== 'node') throw new TypeError('Expected the inventory source.')
          expect(ast.source.terms[0]?.kind).toBe('class')
          return { result: { kind: 'nodes' as const, nodes: [] }, page: {} }
        }
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
    expect(queries).toBe(3)
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

  test('connects without network I/O and list performs exactly one graph call', async () => {
    const contract = fixture({})

    const api = await contract.connect()
    expect(contract.call).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()

    await expect(api.list()).resolves.toEqual([])
    expect(contract.query).toHaveBeenCalledTimes(1)
    expect(contract.call).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('collects bounded pages and never returns a partial inventory after a later failure', async () => {
    const firstPage = Array.from({ length: 256 }, (_, index) =>
      instanceNode({ id: `instance-${index}`, slug: `demo-${index}` }),
    )
    const paginated = fixture({
      query: (_ast, options) => ({
        result: {
          kind: 'nodes' as const,
          nodes: (options.page.after === undefined
            ? firstPage
            : [instanceNode({ id: 'instance-256', slug: 'demo-256' })]
          ).map((value) => ({ kind: 'value' as const, value })),
        },
        page: options.page.after === undefined ? { next: 'page-2' } : {},
      }),
    })

    await expect((await paginated.connect()).list()).resolves.toHaveLength(257)
    expect(paginated.query).toHaveBeenCalledTimes(2)
    expect(paginated.query.mock.calls[1]?.[1]).toEqual({
      page: { size: 256, after: 'page-2' },
    })

    const failed = fixture({
      query: (_ast, options) => {
        if (options.page.after !== undefined) throw new Error('later page failed')
        return {
          result: {
            kind: 'nodes' as const,
            nodes: firstPage.map((value) => ({ kind: 'value' as const, value })),
          },
          page: { next: 'page-2' },
        }
      },
    })

    await expect((await failed.connect()).list()).rejects.toThrow('later page failed')
    expect(failed.query).toHaveBeenCalledTimes(2)
  })

  test('stops at the ordered tombstone boundary before following retained-only pages', async () => {
    const contract = fixture({
      query: () => ({
        result: {
          kind: 'nodes' as const,
          nodes: [instanceNode(), instanceNode({ id: 'deleted', state: 'deleted' })].map(
            (value) => ({ kind: 'value' as const, value }),
          ),
        },
        page: { next: 'more-than-10000-deleted' },
      }),
    })

    await expect((await contract.connect()).list()).resolves.toHaveLength(1)
    expect(contract.query).toHaveBeenCalledTimes(1)
  })

  test('rejects malformed inventory, lifecycle, Method, and install outputs', async () => {
    await expect(
      (
        await fixture({
          queryResult: { result: { kind: 'edges', edges: [] }, page: {} },
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance inventory returned the wrong projection.')
    await expect(
      (
        await fixture({
          instances: [instanceNode({ state: 'mystery' })],
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance state is invalid.')
    await expect(
      (
        await fixture({
          instances: [instanceNode({ class: ClassKey.of(AdminContract.classes.Domain) })],
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance inventory returned a non-Instance Node.')

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
  if (input.phase !== undefined) properties[property.phase] = input.phase
  if (input.failure !== undefined) properties[property.failure] = input.failure
  return Object.freeze({
    id: NodeId(input.id ?? 'instance-node'),
    class: input.class ?? ClassKey.of(AdminContract.classes.Instance),
    props: normalizeProperties(properties),
  })
}
