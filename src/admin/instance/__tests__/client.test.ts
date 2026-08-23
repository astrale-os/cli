import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphApi } from '../../graph'

import { AdminTestDomain, adminBinding, adminSession } from '../../__tests__/fixture'
import { connectAdminInstances } from '../client'

function hostNode(id: string, props: { readonly id: string; readonly state: string }): Node {
  return {
    id: NodeId(id),
    class: AdminTestDomain.classes.Host.key,
    props: AdminTestDomain.classes.Host.properties.from(props),
  }
}

function instanceNode(id: string): Node {
  return {
    id: NodeId(id),
    class: AdminTestDomain.classes.Instance.key,
    props: AdminTestDomain.classes.Instance.properties.from({}),
  }
}

function graphResult(nodes: readonly Node[], cursor?: string) {
  return {
    result: {
      kind: 'nodes' as const,
      nodes: nodes.map((value) => ({ kind: 'value' as const, value })),
    },
    page: cursor === undefined ? {} : { next: cursor },
  }
}

function sourceName(ast: QueryAST): string | undefined {
  const term = ast.source.terms[0]
  return term?.kind === 'class' ? term.class.name : undefined
}

function fixture(input: {
  instances?: readonly Node[]
  hosts?: readonly Node[]
  reserved?: Node | null
  invoke?: (method: { owner: string; name: string }, receiver: unknown, input: unknown) => unknown
}) {
  const calls: Array<{
    method: { owner: string; name: string }
    receiver: string
    value: unknown
  }> = []
  const remote = adminSession((method, receiver, value) => {
    calls.push({ method, receiver: String(receiver), value })
    return input.invoke?.(method, receiver, value)
  })
  const binding = adminBinding()
  const query = mock(async (ast: QueryAST) => {
    const name = sourceName(ast)
    if (name === 'Instance') return graphResult(input.instances ?? [])
    if (name === 'Host') return graphResult(input.hosts ?? [])
    throw new Error(`Unexpected graph query ${String(name)}`)
  })
  const neighbors = mock(async (source: unknown, edge: { name?: string }) => {
    if (String(source) === '/:admin.astrale.ai:core.fleet') return page(input.reserved ?? null)
    if (edge.name === 'instance_runs_on_host') return page(input.hosts?.[0] ?? null)
    throw new Error(`Unexpected neighbor query ${String(source)} ${String(edge)}`)
  })
  const graph = { query, neighbors } as unknown as AdminGraphApi
  return {
    binding,
    graph,
    invoke: remote.invoke,
    calls,
    connect: () =>
      connectAdminInstances(
        { session: remote.session, graph },
        {
          bind: async () => binding,
          operationId: (kind) => `cli.instance.${kind}:test`,
        },
      ),
  }
}

function page(item: Node | null) {
  return {
    nodes: item === null ? [] : [item],
    first: item,
    graph: { nodes: item === null ? [] : [item], edges: [] },
    cursor: null,
  }
}

describe('V2 Admin Instance adapter', () => {
  test('lists caller-visible Instances through the Admin-owned Fleet operation', async () => {
    const contract = fixture({
      invoke: (method) =>
        method.name === 'listInstances'
          ? [
              {
                id: '@instance-node',
                slug: 'demo',
                url: 'https://demo.eu.astrale.ai',
                state: 'ready',
                createdAt: '2026-08-12T00:00:00.000Z',
                updatedAt: '2026-08-12T00:00:00.000Z',
                hostId: '@host-node',
                region: 'fr-par',
              },
            ]
          : undefined,
    })

    await expect((await contract.connect()).list()).resolves.toEqual([
      {
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
        createdAt: '2026-08-12T00:00:00.000Z',
        hostId: '@host-node',
        region: 'fr-par',
      },
    ])
    expect(contract.calls).toEqual([
      {
        method: { owner: 'Fleet', name: 'listInstances' },
        receiver: '/:admin.astrale.ai:core.fleet::listInstances',
        value: {},
      },
    ])
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
    const contract = fixture({
      hosts: [hostNode('host-node', { id: 'host-paris', state: 'ready' })],
      invoke: () => created,
    })

    await expect((await contract.connect()).create('demo')).resolves.toMatchObject({
      id: created.id,
      slug: created.slug,
      url: created.url,
      state: created.state,
      createdAt: created.createdAt,
    })
    expect(contract.calls).toEqual([
      {
        method: { owner: 'Fleet', name: 'createInstance' },
        receiver: '/:admin.astrale.ai:core.fleet::createInstance',
        value: { operationId: 'cli.instance.create:test', slug: 'demo' },
      },
    ])
    expect(contract.graph.query).not.toHaveBeenCalled()
    expect(contract.graph.neighbors).not.toHaveBeenCalled()
  })

  test('resolves --host-id to an exact Host receiver and rejects the reserved Admin Host', async () => {
    const reserved = hostNode('admin-host', { id: 'admin', state: 'ready' })
    const consumer = hostNode('consumer-host', { id: 'consumer-paris', state: 'ready' })
    const contract = fixture({
      hosts: [reserved, consumer],
      reserved,
      invoke: () => ({
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: 'ready',
      }),
    })
    const api = await contract.connect()

    await expect(api.create('demo', 'admin')).rejects.toMatchObject({ code: 'HOST_NOT_FOUND' })
    await expect(api.create('demo', 'consumer-paris')).resolves.toMatchObject({ slug: 'demo' })
    expect(contract.calls.at(-1)).toEqual({
      method: { owner: 'Host', name: 'createInstance' },
      receiver: '@consumer-host::createInstance',
      value: { operationId: 'cli.instance.create:test', slug: 'demo' },
    })
  })

  test('refreshes and deletes through the resolved Instance receiver', async () => {
    const instance = instanceNode('instance-node')
    const contract = fixture({
      instances: [instance],
      invoke: (method) =>
        method.name === 'listInstances'
          ? [
              {
                id: '@instance-node',
                slug: 'demo',
                url: 'https://demo.eu.astrale.ai',
                state: 'ready',
                createdAt: '2026-08-12T00:00:00.000Z',
                updatedAt: '2026-08-12T00:00:00.000Z',
              },
            ]
          : {
              id: '@instance-node',
              slug: 'demo',
              url: 'https://demo.eu.astrale.ai',
              state: method.name === 'delete' ? 'deleted' : 'ready',
            },
    })
    const api = await contract.connect()

    await expect(api.status('demo')).resolves.toMatchObject({ state: 'ready' })
    await expect(api.delete('@instance-node')).resolves.toMatchObject({ state: 'deleted' })
    expect(contract.calls.map(({ method }) => method)).toEqual([
      { owner: 'Fleet', name: 'listInstances' },
      { owner: 'Instance', name: 'status' },
      { owner: 'Fleet', name: 'listInstances' },
      { owner: 'Instance', name: 'delete' },
    ])
  })

  test('installs a resolved catalog Domain through Instance.installDomain', async () => {
    const instance = instanceNode('instance-node')
    const contract = fixture({
      instances: [instance],
      invoke: (method) =>
        method.name === 'listInstances'
          ? [
              {
                id: '@instance-node',
                slug: 'demo',
                url: 'https://demo.eu.astrale.ai',
                state: 'ready',
                createdAt: '2026-08-12T00:00:00.000Z',
                updatedAt: '2026-08-12T00:00:00.000Z',
              },
            ]
          : {
              domain: '@crm-domain',
              instance: '@instance-node',
              origin: 'crm.acme.dev',
              ok: true,
              installedRevision: `sha256:${'a'.repeat(64)}`,
            },
    })
    const api = await contract.connect()

    await expect(api.installDomain('demo', '@crm-domain')).resolves.toMatchObject({
      domain: '@crm-domain',
      instance: '@instance-node',
      origin: 'crm.acme.dev',
      ok: true,
    })
    expect(contract.calls.at(-1)).toEqual({
      method: { owner: 'Instance', name: 'installDomain' },
      receiver: '@instance-node::installDomain',
      value: { operationId: 'cli.instance.install-domain:test', domain: '@crm-domain' },
    })
  })
})
