import { describe, expect, test } from 'bun:test'

import { adminBinding, adminSession } from '../../__tests__/fixture'
import { connectAdminInstances } from '../client'

function fixture(input: {
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
  return {
    binding,
    invoke: remote.invoke,
    calls,
    connect: () =>
      connectAdminInstances(
        { session: remote.session },
        {
          bind: async () => binding,
          operationId: (kind) => `cli.instance.${kind}:test`,
        },
      ),
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
        method: { owner: 'Fleet', name: 'createInstance' },
        receiver: '/:admin.astrale.ai:core.fleet::createInstance',
        value: { operationId: 'cli.instance.create:test', slug: 'demo' },
      },
    ])
  })

  test('refreshes and deletes through the resolved Instance receiver', async () => {
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
