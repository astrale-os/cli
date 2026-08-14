import type { DomainBinding } from '@astrale-os/kernel-client/domain'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { ClassPath } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphApi } from '../../graph'

import { connectAdminCatalog } from '../client'

function definition(name: string) {
  return {
    name,
    $: {
      method(method: string) {
        return { owner: name, name: method }
      },
      property(property: string) {
        return { key: property }
      },
    },
  }
}

function domainNode(id: string, origin: string): Node {
  return {
    id: NodeId(id),
    class: ClassPath.from('admin.astrale.ai', 'Domain'),
    props: {
      origin,
      name: origin.split('.')[0]!,
      discoveryUrl: `https://${origin}`,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    } as never,
  }
}

function fixture(input: {
  domains?: readonly Node[]
  defaults?: readonly Node[]
  invoke?: (method: { owner: string; name: string }, receiver: unknown, value: unknown) => unknown
}) {
  const Domain = definition('Domain')
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
          if (name === 'Domain') return Domain
          if (name === 'Fleet') return Fleet
          throw new Error(`Unexpected class ${name}`)
        },
        core: { nodes: { fleet: { path: Path.id(NodeId('fleet')) } } },
      },
    },
    invoke,
  } as unknown as DomainBinding
  const query = mock(async (_ast: QueryAST) => ({
    kind: 'node' as const,
    nodes: (input.domains ?? []).map((value) => ({ kind: 'value' as const, value })),
  }))
  const defaultNodes = input.defaults ?? []
  const neighbors = mock(async () => ({
    nodes: defaultNodes,
    first: defaultNodes[0] ?? null,
    graph: { nodes: defaultNodes, edges: [] },
    cursor: null,
    collect: async () => ({ nodes: defaultNodes, cursor: null }),
  }))
  const graph = { query, neighbors } as unknown as AdminGraphApi
  return {
    invoke,
    connect: () =>
      connectAdminCatalog(
        { session: {} as never, graph },
        {
          bind: async () => binding,
          operationId: (kind) => `cli.domain.${kind}:test`,
        },
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
    const api = await fixture({ domains: [crm, notes], defaults: [crm] }).connect()

    await expect(api.list()).resolves.toEqual([
      expect.objectContaining({
        id: '@crm-domain',
        origin: 'crm.acme.dev',
        installByDefault: true,
      }),
      expect.objectContaining({ id: '@notes-domain', origin: 'notes.acme.dev' }),
    ])
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
    expect(
      contract.invoke.mock.calls.map(([method, receiver, value]) => ({
        method,
        receiver: String(receiver),
        value,
      })),
    ).toEqual([
      {
        method: { owner: 'Fleet', name: 'publishDomain' },
        receiver: '@fleet',
        value: {
          operationId: 'cli.domain.publish:test',
          origin: 'crm.acme.dev',
          name: 'crm',
          discoveryUrl: 'https://crm.acme.dev',
        },
      },
      {
        method: { owner: 'Domain', name: 'configureDefault' },
        receiver: '@crm-domain',
        value: {
          operationId: 'cli.domain.configure-default:test',
          enabled: true,
        },
      },
    ])
  })

  test('does not invoke a receiver when the catalog record is already current', async () => {
    const crm = domainNode('crm-domain', 'crm.acme.dev')
    const contract = fixture({ domains: [crm] })
    const api = await contract.connect()

    await expect(
      api.publish({ origin: 'crm.acme.dev', name: 'crm', url: 'https://crm.acme.dev' }),
    ).resolves.toMatchObject({ changed: false, isNew: false })
    expect(contract.invoke).not.toHaveBeenCalled()
  })
})
