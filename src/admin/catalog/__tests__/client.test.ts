import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

import { NodeId } from '@astrale-os/sdk/graph/node'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphApi } from '../../graph'

import { AdminTestDomain, adminBinding, adminSession } from '../../__tests__/fixture'
import { connectAdminCatalog } from '../client'

function domainNode(id: string, origin: string): Node {
  return {
    id: NodeId(id),
    class: AdminTestDomain.classes.Domain.key,
    props: AdminTestDomain.classes.Domain.properties.from({
      origin,
      name: origin.split('.')[0]!,
      discoveryUrl: `https://${origin}`,
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    }),
  }
}

function fixture(input: {
  domains?: readonly Node[]
  defaults?: readonly Node[]
  invoke?: (method: { owner: string; name: string }, receiver: unknown, value: unknown) => unknown
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
  const query = mock(async (_ast: QueryAST) => ({
    result: {
      kind: 'nodes' as const,
      nodes: (input.domains ?? []).map((value) => ({ kind: 'value' as const, value })),
    },
    page: {},
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
    invoke: remote.invoke,
    calls,
    connect: () =>
      connectAdminCatalog(
        { session: remote.session, graph },
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
    expect(contract.calls).toEqual([
      {
        method: { owner: 'Fleet', name: 'publishDomain' },
        receiver: '/:admin.astrale.ai:core.fleet::publishDomain',
        value: {
          operationId: 'cli.domain.publish:test',
          origin: 'crm.acme.dev',
          name: 'crm',
          discoveryUrl: 'https://crm.acme.dev',
        },
      },
      {
        method: { owner: 'Domain', name: 'configureDefault' },
        receiver: '@crm-domain::configureDefault',
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
