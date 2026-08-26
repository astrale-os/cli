import { describe, expect, test } from 'bun:test'

import { adminSession } from '../../__tests__/fixture'
import { connectAdminInstances } from '../client'

function fixture(input: { invoke?: (target: string, input: unknown) => unknown }) {
  const calls: Array<{
    target: string
    value: unknown
  }> = []
  const remote = adminSession((target, value) => {
    calls.push({ target, value })
    return input.invoke?.(target, value)
  })
  return {
    call: remote.call,
    reflection: remote.reflection,
    calls,
    connect: () =>
      connectAdminInstances(
        { session: remote.session },
        {
          operationId: (kind) => `cli.instance.${kind}:test`,
        },
      ),
  }
}

describe('V2 Admin Instance adapter', () => {
  test('lists caller-visible Instances through the Admin-owned Fleet operation', async () => {
    const contract = fixture({
      invoke: (target) =>
        target.endsWith('::listInstances')
          ? [
              {
                id: '@instance-node',
                slug: 'demo',
                url: 'https://demo.eu.astrale.ai',
                hostId: '@host-node',
                region: 'fr-par',
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
        hostId: '@host-node',
        region: 'fr-par',
        state: 'ready',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      },
    ])
    expect(contract.calls).toEqual([
      {
        target: '/:admin.astrale.ai:core.fleet::listInstances',
        value: {},
      },
    ])
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
        value: { operationId: 'cli.instance.create:test', slug: 'demo' },
      },
    ])
  })

  test('refreshes and deletes through the resolved Instance receiver', async () => {
    const contract = fixture({
      invoke: (target) =>
        target.endsWith('::listInstances')
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
              state: target.endsWith('::delete') ? 'deleted' : 'ready',
              createdAt: '2026-08-12T00:00:00.000Z',
              updatedAt: '2026-08-12T00:00:00.000Z',
            },
    })
    const api = await contract.connect()

    await expect(api.status('demo')).resolves.toMatchObject({ state: 'ready' })
    await expect(api.delete('@instance-node')).resolves.toMatchObject({ state: 'deleted' })
    expect(contract.calls).toEqual([
      { target: '/:admin.astrale.ai:core.fleet::listInstances', value: {} },
      {
        target: '@instance-node::status',
        value: { operationId: 'cli.instance.status:test' },
      },
      { target: '/:admin.astrale.ai:core.fleet::listInstances', value: {} },
      {
        target: '@instance-node::delete',
        value: { operationId: 'cli.instance.delete:test' },
      },
    ])
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('installs a resolved catalog Domain through Instance.installDomain', async () => {
    const contract = fixture({
      invoke: (target) =>
        target.endsWith('::listInstances')
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
      target: '@instance-node::installDomain',
      value: { operationId: 'cli.instance.install-domain:test', domain: '@crm-domain' },
    })
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('connects without network I/O and list performs exactly one call', async () => {
    const contract = fixture({ invoke: () => [] })

    const api = await contract.connect()
    expect(contract.call).not.toHaveBeenCalled()
    expect(contract.reflection).not.toHaveBeenCalled()

    await expect(api.list()).resolves.toEqual([])
    expect(contract.call).toHaveBeenCalledTimes(1)
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('rejects malformed inventory, lifecycle, Method, and install outputs', async () => {
    await expect((await fixture({ invoke: () => ({}) }).connect()).list()).rejects.toThrow(
      'Admin Instance inventory is invalid.',
    )
    await expect(
      (
        await fixture({
          invoke: () => [{ id: '@instance-node', slug: 'demo', state: 'mystery' }],
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance state is invalid.')
    await expect(
      (
        await fixture({
          invoke: () => [{ id: 'not-a-path', slug: 'demo', state: 'ready' }],
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Instance id is invalid.')
    await expect(
      (
        await fixture({
          invoke: () => [
            { id: '@instance-node', slug: 'demo', hostId: 'not-a-path', state: 'ready' },
          ],
        }).connect()
      ).list(),
    ).rejects.toThrow('Admin Host id is invalid.')

    const malformedStatus = fixture({
      invoke: (target) =>
        target.endsWith('::listInstances')
          ? [
              {
                id: '@instance-node',
                slug: 'demo',
                state: 'ready',
                createdAt: '2026-08-12T00:00:00.000Z',
                updatedAt: '2026-08-12T00:00:00.000Z',
              },
            ]
          : {
              id: '@instance-node',
              slug: 'demo',
              state: 'ready',
              failure: {},
              createdAt: '2026-08-12T00:00:00.000Z',
              updatedAt: '2026-08-12T00:00:00.000Z',
            },
    })
    await expect((await malformedStatus.connect()).status('demo')).rejects.toThrow(
      'Admin failure message is invalid.',
    )

    const malformedInstall = fixture({
      invoke: (target) =>
        target.endsWith('::listInstances')
          ? [
              {
                id: '@instance-node',
                slug: 'demo',
                state: 'ready',
                createdAt: '2026-08-12T00:00:00.000Z',
                updatedAt: '2026-08-12T00:00:00.000Z',
              },
            ]
          : {
              domain: '@crm-domain',
              instance: '@instance-node',
              origin: 'crm.acme.dev',
              ok: 'yes',
            },
    })
    await expect(
      (await malformedInstall.connect()).installDomain('demo', '@crm-domain'),
    ).rejects.toThrow('Admin Domain install outcome is invalid.')

    const malformedInstallPath = fixture({
      invoke: (target) =>
        target.endsWith('::listInstances')
          ? [{ id: '@instance-node', slug: 'demo', state: 'ready' }]
          : { domain: 'not-a-path', instance: '@instance-node', origin: 'crm.acme.dev', ok: true },
    })
    await expect(
      (await malformedInstallPath.connect()).installDomain('demo', '@crm-domain'),
    ).rejects.toThrow('Admin Domain reference is invalid.')
  })
})
