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

function fixture(input: {
  instances?: readonly Node[]
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
        {
          operationId: (kind) => `cli.instance.${kind}.test`,
        },
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
        select: { kind: 'nodes', binding: 'n0', projection: { kind: 'value' } },
      },
      { page: { size: 256 } },
    )
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
