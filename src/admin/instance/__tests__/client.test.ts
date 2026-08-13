import type { DomainBinding } from '@astrale-os/kernel-client/domain'
import type { Node } from '@astrale-os/kernel-core/graph/node'
import type { QueryAST, QueryResult } from '@astrale-os/kernel-core/graph/query'

import { ClassPath } from '@astrale-os/kernel-core/graph/class'
import { NodeId } from '@astrale-os/kernel-core/graph/node'
import { Path } from '@astrale-os/kernel-core/path'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphApi } from '../../graph'

import { connectAdminInstances } from '../client'

const methods: Array<{ owner: string; name: string }> = []

function definition(name: string) {
  return {
    name,
    $: {
      method(method: string) {
        const value = { owner: name, name: method }
        methods.push(value)
        return value
      },
      property(property: string) {
        return { key: property }
      },
    },
  }
}

function node(id: string, props: Record<string, unknown>): Node {
  return {
    id: NodeId(id),
    class: ClassPath.from('admin.astrale.ai', 'Instance'),
    props: props as never,
  }
}

function graphResult(nodes: readonly Node[], cursor?: string): QueryResult {
  return {
    kind: 'node',
    nodes: nodes.map((value) => ({ kind: 'value' as const, value })),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

function sourceName(ast: QueryAST): string | undefined {
  const term = ast.source.terms[0]
  return term?.kind === 'definition' ? term.definition.name : undefined
}

function fixture(input: {
  instances?: readonly Node[]
  hosts?: readonly Node[]
  reserved?: Node | null
  invoke?: (method: { owner: string; name: string }, receiver: unknown, input: unknown) => unknown
}) {
  methods.length = 0
  const Instance = definition('Instance')
  const Host = definition('Host')
  const Fleet = definition('Fleet')
  const invoke = mock(async (method: unknown, receiver: unknown, value: unknown) =>
    input.invoke?.(method as { owner: string; name: string }, receiver, value),
  )
  const binding = {
    publication: { origin: 'admin.astrale.ai' },
    domain: {
      $: {
        origin: 'admin.astrale.ai',
        class(name: string) {
          if (name === 'Instance') return Instance
          if (name === 'Host') return Host
          if (name === 'Fleet') return Fleet
          throw new Error(`Unexpected class ${name}`)
        },
        core: { nodes: { fleet: { path: Path.id(NodeId('fleet')) } } },
      },
    },
    invoke,
  } as unknown as DomainBinding
  const query = mock(async (ast: QueryAST) => {
    const name = sourceName(ast)
    if (name === 'Instance') return graphResult(input.instances ?? [])
    if (name === 'Host') return graphResult(input.hosts ?? [])
    throw new Error(`Unexpected graph query ${String(name)}`)
  })
  const neighbors = mock(async (source: unknown, edge: { raw?: string }) => {
    if (String(source) === '@fleet') return page(input.reserved ?? null)
    if (String(edge).includes('instance_runs_on_host')) return page(input.hosts?.[0] ?? null)
    throw new Error(`Unexpected neighbor query ${String(source)} ${String(edge)}`)
  })
  const graph = { query, neighbors } as unknown as AdminGraphApi
  return {
    binding,
    graph,
    invoke,
    connect: () =>
      connectAdminInstances(
        { session: {} as never, graph },
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
  test('lists caller-visible Instance nodes through GraphApi and projects Host location', async () => {
    const instance = node('instance-node', {
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'ready',
      createdAt: '2026-08-12T00:00:00.000Z',
    })
    const host = node('host-node', { id: 'host-paris', state: 'ready', region: 'fr-par' })
    const contract = fixture({ instances: [instance], hosts: [host] })

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
  })

  test('invokes Fleet.createInstance with an internal operation identity', async () => {
    const created = {
      id: '@instance-node',
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'ready',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    }
    const contract = fixture({
      hosts: [node('host-node', { id: 'host-paris', state: 'ready' })],
      invoke: () => created,
    })

    await expect((await contract.connect()).create('demo')).resolves.toMatchObject({
      id: created.id,
      slug: created.slug,
      url: created.url,
      state: created.state,
      createdAt: created.createdAt,
    })
    expect(contract.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'Fleet', name: 'createInstance' }),
      Path.id(NodeId('fleet')),
      { operationId: 'cli.instance.create:test', slug: 'demo' },
    )
  })

  test('resolves --host-id to an exact Host receiver and rejects the reserved Admin Host', async () => {
    const reserved = node('admin-host', { id: 'admin', state: 'ready' })
    const consumer = node('consumer-host', { id: 'consumer-paris', state: 'ready' })
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

    await expect(api.create('demo', 'admin')).rejects.toMatchObject({ name: 'NotFoundError' })
    await expect(api.create('demo', 'consumer-paris')).resolves.toMatchObject({ slug: 'demo' })
    expect(contract.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'Host', name: 'createInstance' }),
      Path.id(NodeId('consumer-host')),
      { operationId: 'cli.instance.create:test', slug: 'demo' },
    )
  })

  test('refreshes and deletes through the resolved Instance receiver', async () => {
    const instance = node('instance-node', {
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'ready',
    })
    const contract = fixture({
      instances: [instance],
      invoke: (method) => ({
        id: '@instance-node',
        slug: 'demo',
        url: 'https://demo.eu.astrale.ai',
        state: method.name === 'delete' ? 'deleted' : 'ready',
      }),
    })
    const api = await contract.connect()

    await expect(api.status('demo')).resolves.toMatchObject({ state: 'ready' })
    await expect(api.delete('@instance-node')).resolves.toMatchObject({ state: 'deleted' })
    expect(contract.invoke.mock.calls.map(([method]) => method)).toEqual([
      expect.objectContaining({ owner: 'Instance', name: 'status' }),
      expect.objectContaining({ owner: 'Instance', name: 'delete' }),
    ])
  })

  test('installs a resolved catalog Domain through Instance.installDomain', async () => {
    const instance = node('instance-node', {
      slug: 'demo',
      url: 'https://demo.eu.astrale.ai',
      state: 'ready',
    })
    const contract = fixture({
      instances: [instance],
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
    expect(contract.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'Instance', name: 'installDomain' }),
      Path.id(NodeId('instance-node')),
      { operationId: 'cli.instance.install-domain:test', domain: '@crm-domain' },
    )
  })
})
