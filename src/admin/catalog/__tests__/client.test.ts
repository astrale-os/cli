import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { PropertyKey } from '@astrale-os/sdk/schema'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphApi } from '../../graph'

import { adminSession } from '../../__tests__/fixture'
import { AdminContract } from '../../contract'
import { connectAdminCatalog } from '../client'
import { AdminCatalogOriginConflictError } from '../model'
import { fakeAdmin, type FakeAdminInput } from './fake-admin'

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
  fleet?: string
  fleets?: readonly Node[]
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
      nodes: (JSON.stringify(_ast.source).includes('"name":"Fleet"')
        ? (input.fleets ?? [fleetNode('default-fleet', 'default')])
        : (input.domains ?? [])
      ).map((value) => ({ kind: 'value' as const, value })),
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
        { session: remote.session, graph, fleet: input.fleet ?? AdminContract.fleet.raw },
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
    const query = contract.query.mock.calls[1]![0]
    expect(JSON.stringify(query.source)).toContain('@default-fleet')
    expect(query.steps[0]).toMatchObject({
      op: 'expand',
      via: [AdminContract.edges.fleetContains, AdminContract.edges.fleetListsDomain],
      direction: 'outgoing',
    })
    expect(JSON.stringify(query.steps)).toContain('Domain')
    const [source, edge, options] = contract.neighbors.mock.calls[0]!
    expect(String(source)).toBe('@default-fleet')
    expect(edge).toEqual({
      origin: 'admin.astrale.ai',
      kind: 'class',
      name: 'fleet_installs_domain_by_default',
    })
    expect(options).toEqual({ direction: 'outgoing', page: { size: 256 } })
  })

  test.each([undefined, '@astrale-fleet'])(
    'publishes through Fleet %s then configures its Domain default on the same Fleet',
    async (fleet) => {
      const contract = fixture({ fleet, invoke: () => summary('crm.acme.dev') })
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
          target: `${fleet ?? '/:admin.astrale.ai:core.fleet'}::admin.astrale.ai:class.Fleet.method.publishDomain`,
          value: {
            operationId: 'cli.domain.publish.test',
            origin: 'crm.acme.dev',
            name: 'crm',
            discoveryUrl: 'https://crm.acme.dev',
          },
        },
        {
          target: `${fleet ?? '/:admin.astrale.ai:core.fleet'}::admin.astrale.ai:class.Fleet.method.configureDomainDefault`,
          value: {
            operationId: 'cli.domain.configure-default.test',
            domain: '@crm-domain',
            enabled: true,
          },
        },
      ])
    },
  )

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

test('scopes catalogue reads to the supplied Fleet path without discovery', async () => {
  const contract = fixture({ fleet: '@astrale-fleet' })
  const api = await contract.connect()
  await api.list()
  expect(contract.query.mock.calls[0]?.[0].source).toMatchObject({
    terms: [{ kind: 'path', path: '@astrale-fleet' }],
  })
  expect(contract.calls).toHaveLength(0)
})

function fleetNode(id: string, slug?: string): Node {
  return {
    id: NodeId(id),
    class: 'admin.astrale.ai:class.Fleet' as Node['class'],
    props: normalizeProperties(
      slug === undefined
        ? {}
        : { [PropertyKey('admin.astrale.ai:class.Fleet.property.slug')]: slug },
    ),
  }
}

test('an invisible default never falls back to another visible Fleet', async () => {
  const contract = fixture({
    fleets: [fleetNode('astrale', 'astrale')],
    domains: [domainNode('private', 'private.example')],
  })
  await expect((await contract.connect()).list()).resolves.toEqual([])
  expect(contract.neighbors).not.toHaveBeenCalled()
})

test.each([
  { name: 'legacy slug', fleets: [fleetNode('legacy')] },
  {
    name: 'duplicate defaults',
    fleets: [fleetNode('one', 'default'), fleetNode('two', 'default')],
  },
])('refuses $name before catalog traversal', async ({ fleets }) => {
  const contract = fixture({ fleets })
  await expect((await contract.connect()).list()).rejects.toThrow(/migration|ambiguous/)
  expect(contract.neighbors).not.toHaveBeenCalled()
})

test('finds the default on a later Fleet page and uses only its observed ID', async () => {
  const contract = fixture({})
  contract.query.mockResolvedValueOnce({
    result: { kind: 'nodes', nodes: [{ kind: 'value', value: fleetNode('other', 'astrale') }] },
    page: { next: 'next-fleet-page' },
  })
  contract.query.mockResolvedValueOnce({
    result: {
      kind: 'nodes',
      nodes: [{ kind: 'value', value: fleetNode('default-fleet', 'default') }],
    },
    page: {},
  })
  await (await contract.connect()).list()
  expect(String(contract.neighbors.mock.calls[0]![0])).toBe('@default-fleet')
  expect(JSON.stringify(contract.query.mock.calls[2]![0].source)).toContain('@default-fleet')
})

describe('one Domain per origin (admin #446)', () => {
  const SHELL = 'https://shell.astrale.ai/.well-known/astrale/domain.json'
  /** The core Fleet contains the platform Domain; the tenant Fleet lists it. */
  const merged = (more: Partial<FakeAdminInput> = {}) =>
    fakeAdmin({
      fleets: [
        { id: 'core-fleet', slug: 'default' },
        { id: 'tenant-fleet', slug: 'tenant' },
      ],
      domains: [{ id: 'shell-domain', origin: 'shell.astrale.ai', discoveryUrl: SHELL }],
      edges: [
        ['fleet_contains', 'core-fleet', 'shell-domain'],
        ['fleet_lists_domain', 'tenant-fleet', 'shell-domain'],
        ['fleet_installs_domain_by_default', 'core-fleet', 'shell-domain'],
      ],
      ...more,
    })
  const connect = (admin: ReturnType<typeof fakeAdmin>, fleet: string) =>
    connectAdminCatalog(
      { session: admin.session, graph: admin.graph, fleet },
      { operationId: (kind) => `cli.domain.${kind}.test` },
    )

  test('a non-core Fleet lists a Domain it reaches through fleet_lists_domain', async () => {
    const admin = merged()

    await expect((await connect(admin, '@tenant-fleet')).list()).resolves.toEqual([
      {
        id: '@shell-domain',
        origin: 'shell.astrale.ai',
        name: 'shell',
        url: SHELL,
        createdAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
      },
    ])
    // The core Fleet's default is its own: the tenant Fleet has none.
    await expect((await connect(admin, AdminContract.fleet.raw)).list()).resolves.toEqual([
      expect.objectContaining({ id: '@shell-domain', installByDefault: true }),
    ])
    expect(admin.calls).toEqual([])
  })

  test('a Domain both contained and listed by the Fleet is listed once', async () => {
    const admin = merged({
      edges: [
        ['fleet_contains', 'tenant-fleet', 'shell-domain'],
        ['fleet_lists_domain', 'tenant-fleet', 'shell-domain'],
      ],
    })

    const listed = await (await connect(admin, '@tenant-fleet')).list()

    // The Kernel selects each Node once (Query V2 law 9), as the fake Admin does.
    expect(listed.map((domain) => domain.id)).toEqual(['@shell-domain'])
  })

  test('a Domain Admin answers twice is refused, not silently kept once', async () => {
    const admin = merged({
      witnesses: true,
      edges: [
        ['fleet_contains', 'tenant-fleet', 'shell-domain'],
        ['fleet_lists_domain', 'tenant-fleet', 'shell-domain'],
      ],
    })

    await expect((await connect(admin, '@tenant-fleet')).list()).rejects.toThrow(
      'Admin Domain catalog repeated a Node.',
    )
  })

  test('a catalog Domain without a discovery URL is listed without one', async () => {
    const admin = merged({
      domains: [{ id: 'shell-domain', origin: 'shell.astrale.ai' }],
    })

    const [domain] = await (await connect(admin, '@tenant-fleet')).list()

    expect(domain).toEqual(expect.objectContaining({ id: '@shell-domain' }))
    expect(domain).not.toHaveProperty('url')
  })

  test('--install-by-default on a listed Domain calls Fleet.configureDomainDefault only', async () => {
    const admin = merged()

    await expect(
      (await connect(admin, '@tenant-fleet')).publish({
        origin: 'shell.astrale.ai',
        name: 'shell',
        url: SHELL,
        installByDefault: true,
      }),
    ).resolves.toEqual({
      entry: expect.objectContaining({ id: '@shell-domain', installByDefault: true }),
      changed: true,
      isNew: false,
    })
    expect(admin.calls).toEqual([
      {
        target: '@tenant-fleet::admin.astrale.ai:class.Fleet.method.configureDomainDefault',
        value: {
          operationId: 'cli.domain.configure-default.test',
          domain: '@shell-domain',
          enabled: true,
        },
      },
    ])
    expect(admin.relations()).toContainEqual([
      'fleet_installs_domain_by_default',
      'tenant-fleet',
      'shell-domain',
    ])
  })

  test('the core Fleet catalogues a new origin and then sets its default', async () => {
    const admin = merged()

    await expect(
      (await connect(admin, AdminContract.fleet.raw)).publish({
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
        installByDefault: true,
      }),
    ).resolves.toMatchObject({ changed: true, isNew: true, entry: { id: '@crm-domain' } })
    expect(admin.calls.map(({ target }) => target.split('::')[1])).toEqual([
      'admin.astrale.ai:class.Fleet.method.publishDomain',
      'admin.astrale.ai:class.Fleet.method.configureDomainDefault',
    ])
  })

  test.each([
    {
      name: 'a new origin on a non-core Fleet',
      fleet: '@tenant-fleet',
      origin: 'crm.acme.dev',
      reason: 'not-in-fleet',
      message:
        'Admin refused to catalogue crm.acme.dev in this Fleet: only the core Fleet catalogues a new origin.',
      hint: /astrale domain install <url> --direct -i <instance>/,
    },
    {
      name: "a listed Domain's new URL on a non-core Fleet",
      fleet: '@tenant-fleet',
      origin: 'shell.astrale.ai',
      reason: 'not-in-fleet',
      message:
        "This Fleet lists shell.astrale.ai from another Fleet's catalog; only that Fleet changes its name, URL or description.",
      hint: /current --name and --public-url/,
    },
    {
      name: 'an origin another Fleet holds, on the core Fleet',
      fleet: AdminContract.fleet.raw,
      origin: 'notes.acme.dev',
      reason: 'in-another-fleet',
      message:
        'Admin refused to catalogue notes.acme.dev: another Fleet already holds its Domain, and Admin keeps one Domain per origin.',
      hint: /Align or remove/,
    },
  ])(
    'refuses $name as CATALOG_ORIGIN_CONFLICT',
    async ({ fleet, origin, reason, message, hint }) => {
      const admin = merged({
        domains: [
          { id: 'shell-domain', origin: 'shell.astrale.ai', discoveryUrl: SHELL },
          { id: 'notes-domain', origin: 'notes.acme.dev', discoveryUrl: 'https://notes.acme.dev' },
        ],
        edges: [
          ['fleet_contains', 'core-fleet', 'shell-domain'],
          ['fleet_lists_domain', 'tenant-fleet', 'shell-domain'],
          ['fleet_contains', 'tenant-fleet', 'notes-domain'],
        ],
      })
      const before = admin.relations()

      const refused = await (
        await connect(admin, fleet)
      )
        .publish({ origin, name: 'renamed', url: `https://${origin}/v2`, installByDefault: true })
        .then(
          () => undefined,
          (error: unknown) => error,
        )

      expect(refused).toBeInstanceOf(AdminCatalogOriginConflictError)
      expect(refused).toMatchObject({ code: 'CATALOG_ORIGIN_CONFLICT', origin, reason, message })
      expect((refused as AdminCatalogOriginConflictError).hint).toMatch(hint)
      expect(admin.calls.map(({ target }) => target.split('::')[1])).toEqual([
        'admin.astrale.ai:class.Fleet.method.publishDomain',
      ])
      expect(admin.relations()).toEqual(before)
    },
  )

  test('another publication refusal passes through unchanged', async () => {
    const failure = new Error('Admin is unavailable.')
    const contract = fixture({
      invoke: () => {
        throw failure
      },
    })

    await expect(
      (await contract.connect()).publish({
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
      }),
    ).rejects.toBe(failure)
  })
})
