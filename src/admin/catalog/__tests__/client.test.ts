import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { PropertyKey } from '@astrale-os/sdk/schema'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphApi } from '../../graph'

import { adminSession } from '../../__tests__/fixture'
import { connectAdminCatalog } from '../client'

const domainProperties = Object.freeze({
  origin: PropertyKey('admin.astrale.ai:class.Domain.property.origin'),
  name: PropertyKey('kernel.astrale.ai:class.Named.property.name'),
  discoveryUrl: PropertyKey('admin.astrale.ai:class.Domain.property.discoveryUrl'),
  description: PropertyKey('kernel.astrale.ai:class.Descriptable.property.description'),
  createdAt: PropertyKey('kernel.astrale.ai:class.Timestamped.property.createdAt'),
  updatedAt: PropertyKey('kernel.astrale.ai:class.Timestamped.property.updatedAt'),
})

function domainNode(id: string, origin: string): Node {
  return {
    id: NodeId(id),
    class: 'admin.astrale.ai:Domain' as Node['class'],
    props: normalizeProperties({
      [domainProperties.origin]: origin,
      [domainProperties.name]: origin.split('.')[0]!,
      [domainProperties.discoveryUrl]: `https://${origin}`,
      [domainProperties.description]: `${origin} description`,
      [domainProperties.createdAt]: '2026-08-12T00:00:00.000Z',
      [domainProperties.updatedAt]: '2026-08-12T00:00:00.000Z',
    }),
  }
}

function fixture(input: {
  domains?: readonly Node[]
  defaults?: readonly Node[]
  useDefaultOperationIds?: boolean
  invoke?: (target: string, value: unknown) => unknown
}) {
  const calls: Array<{
    target: string
    value: unknown
  }> = []
  const remote = adminSession((target, value) => {
    calls.push({ target, value })
    return input.invoke?.(target, value)
  })
  const query = mock(async (_ast: QueryAST) => ({
    result: {
      kind: 'nodes' as const,
      nodes: (input.domains ?? []).map((value) => ({ kind: 'value' as const, value })),
    },
    page: {},
  }))
  const defaultNodes = input.defaults ?? []
  const neighbors = mock(
    async (
      _source: Parameters<AdminGraphApi['neighbors']>[0],
      _via: Parameters<AdminGraphApi['neighbors']>[1],
      _options: Parameters<AdminGraphApi['neighbors']>[2],
    ) => ({
      nodes: defaultNodes,
      first: defaultNodes[0] ?? null,
      graph: { nodes: defaultNodes, edges: [] },
      cursor: null,
      collect: async () => ({ nodes: defaultNodes, cursor: null }),
    }),
  )
  const graph = { query, neighbors } as unknown as AdminGraphApi
  return {
    call: remote.call,
    reflection: remote.reflection,
    query,
    neighbors,
    calls,
    connect: () =>
      connectAdminCatalog(
        { session: remote.session, graph },
        input.useDefaultOperationIds
          ? undefined
          : { operationId: (kind) => `cli.domain.${kind}.test` },
      ),
  }
}

function summary(origin: string) {
  return {
    id: '@crm-domain',
    origin,
    name: 'crm',
    discoveryUrl: `https://${origin}`,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  }
}

describe('V2 Admin Domain catalog adapter', () => {
  test('lists Domain nodes through GraphApi and joins the Fleet default relation', async () => {
    const crm = domainNode('crm-domain', 'crm.acme.dev')
    const notes = domainNode('notes-domain', 'notes.acme.dev')
    const contract = fixture({ domains: [crm, notes], defaults: [crm] })
    const api = await contract.connect()

    await expect(api.list()).resolves.toEqual([
      {
        id: '@crm-domain',
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
        description: 'crm.acme.dev description',
        installByDefault: true,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
      {
        id: '@notes-domain',
        origin: 'notes.acme.dev',
        name: 'notes',
        url: 'https://notes.acme.dev',
        description: 'notes.acme.dev description',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ])
    expect(contract.query).toHaveBeenCalledWith(
      {
        format: 'astrale.graph.query',
        version: 'v6',
        source: {
          kind: 'node',
          terms: [
            {
              kind: 'class',
              class: { origin: 'admin.astrale.ai', kind: 'class', name: 'Domain' },
            },
          ],
          binding: 'n0',
        },
        steps: [],
        select: { kind: 'nodes', binding: 'n0', projection: { kind: 'value' } },
      },
      { page: { size: 256 } },
    )
    const [source, edge, options] = contract.neighbors.mock.calls[0]!
    expect(String(source)).toBe('/:admin.astrale.ai:core.fleet')
    expect(edge).toEqual({
      origin: 'admin.astrale.ai',
      kind: 'class',
      name: 'fleet_installs_domain_by_default',
    })
    expect(options).toEqual({ direction: 'outgoing', page: { size: 256 } })
  })

  test('publishes through Fleet then configures the Domain default explicitly', async () => {
    const contract = fixture({ invoke: () => summary('crm.acme.dev') })
    const api = await contract.connect()

    await expect(
      api.publish({
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
        installByDefault: true,
      }),
    ).resolves.toMatchObject({ changed: true, isNew: true, entry: { installByDefault: true } })
    expect(contract.calls).toEqual([
      {
        target: '/:admin.astrale.ai:core.fleet::admin.astrale.ai:class.Fleet.method.publishDomain',
        value: {
          operationId: 'cli.domain.publish.test',
          origin: 'crm.acme.dev',
          name: 'crm',
          discoveryUrl: 'https://crm.acme.dev',
        },
      },
      {
        target: '@crm-domain::admin.astrale.ai:class.Domain.method.configureDefault',
        value: {
          operationId: 'cli.domain.configure-default.test',
          enabled: true,
        },
      },
    ])
  })

  test('uses protocol-safe generated operation ids on the default adapter path', async () => {
    const contract = fixture({
      useDefaultOperationIds: true,
      invoke: () => summary('crm.acme.dev'),
    })

    await (
      await contract.connect()
    ).publish({
      origin: 'crm.acme.dev',
      name: 'crm',
      url: 'https://crm.acme.dev',
      installByDefault: true,
    })

    expect(contract.calls.map(({ value }) => value)).toEqual([
      expect.objectContaining({
        operationId: expect.stringMatching(
          /^cli\.domain\.publish\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
      }),
      expect.objectContaining({
        operationId: expect.stringMatching(
          /^cli\.domain\.configure-default\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
      }),
    ])
  })

  test('does not invoke a receiver when the catalog record is already current', async () => {
    const crm = domainNode('crm-domain', 'crm.acme.dev')
    const contract = fixture({ domains: [crm] })
    const api = await contract.connect()

    await expect(
      api.publish({ origin: 'crm.acme.dev', name: 'crm', url: 'https://crm.acme.dev' }),
    ).resolves.toMatchObject({ changed: false, isNew: false })
    expect(contract.call).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('connects without schema discovery or graph I/O', async () => {
    const contract = fixture({})

    await contract.connect()

    expect(contract.call).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()
    expect(contract.query).not.toHaveBeenCalled()
    expect(contract.neighbors).not.toHaveBeenCalled()
  })

  test('rejects malformed graph records and publication summaries', async () => {
    const invalidNode = {
      id: NodeId('invalid-domain'),
      class: 'admin.astrale.ai:Domain' as Node['class'],
      props: normalizeProperties({
        [domainProperties.origin]: 'invalid.example.dev',
        [domainProperties.name]: 'invalid',
        [domainProperties.discoveryUrl]: 'https://invalid.example.dev',
        [domainProperties.createdAt]: '2026-08-12T00:00:00.000Z',
      }),
    }
    await expect((await fixture({ domains: [invalidNode] }).connect()).list()).rejects.toThrow(
      'Admin Domain.updatedAt is invalid.',
    )

    const malformed = fixture({ invoke: () => ({ id: '@domain-only' }) })
    await expect(
      (await malformed.connect()).publish({
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
      }),
    ).rejects.toThrow('Admin Domain origin is invalid.')

    const malformedPath = fixture({ invoke: () => ({ ...summary('crm.acme.dev'), id: 'bad' }) })
    await expect(
      (await malformedPath.connect()).publish({
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
      }),
    ).rejects.toThrow('Admin Domain id is invalid.')
  })
})
