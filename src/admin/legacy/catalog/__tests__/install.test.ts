import type { Node } from '@astrale-os/sdk/graph/node'

import { ClassKey } from '@astrale-os/sdk/graph/class'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { normalizeProperties } from '@astrale-os/sdk/graph/properties'
import { describe, expect, mock, test } from 'bun:test'

import type { AdminGraphQueryApi } from '../../../graph'

import { adminSession } from '../../../__tests__/fixture'
import { AdminContract } from '../../../contract'
import { installCatalogDomain, type CatalogInstallDependencies } from '../install'

/** The demo Instance the caller can see, as the Instance adapter's graph lookup returns it. */
function instanceNode(): Node {
  const property = AdminContract.properties.instance
  return Object.freeze({
    id: NodeId('instance-node'),
    class: ClassKey.of(AdminContract.classes.Instance),
    props: normalizeProperties({
      [property.slug]: 'demo',
      [property.url]: 'https://demo.eu.astrale.ai',
      [property.state]: 'ready',
      [property.createdAt]: '2026-08-12T00:00:00.000Z',
      [property.updatedAt]: '2026-08-12T00:00:00.000Z',
    }),
  })
}

function fixture(input: { invoke: (target: string, value: unknown) => unknown }) {
  const calls: Array<{ target: string; value: unknown }> = []
  const remote = adminSession((target, value) => {
    calls.push({ target, value })
    return input.invoke(target, value)
  })
  const query = mock(async () => ({
    result: {
      kind: 'nodes' as const,
      nodes: [{ kind: 'value' as const, value: instanceNode() }],
    },
    page: {},
  }))
  const graph = { query } as unknown as AdminGraphQueryApi
  return {
    calls,
    query,
    reflection: remote.reflection,
    install: (
      dependencies: CatalogInstallDependencies = {
        operationId: () => 'cli.instance.install-domain.test',
      },
    ) =>
      installCatalogDomain(
        { session: remote.session, graph, fleet: AdminContract.fleet.raw },
        'demo',
        '@crm-domain',
        dependencies,
      ),
  }
}

describe('Fleet catalog install through Instance.installDomain', () => {
  test('installs a resolved catalog Domain through Instance.installDomain', async () => {
    const contract = fixture({
      invoke: () => ({
        domain: '@crm-domain',
        instance: '@instance-node',
        origin: 'crm.acme.dev',
        ok: true,
        installedRevision: `sha256:${'a'.repeat(64)}`,
      }),
    })

    await expect(contract.install()).resolves.toMatchObject({
      domain: '@crm-domain',
      instance: '@instance-node',
      origin: 'crm.acme.dev',
      ok: true,
    })
    expect(contract.calls.at(-1)).toEqual({
      target: '@instance-node::admin.astrale.ai:class.Instance.method.installDomain',
      value: { operationId: 'cli.instance.install-domain.test', domain: '@crm-domain' },
    })
    expect(contract.query).toHaveBeenCalledTimes(1)
    expect(contract.reflection).not.toHaveBeenCalled()
  })

  test('keeps the Instance adapter operation id namespace on the default path', async () => {
    const contract = fixture({
      invoke: () => ({
        domain: '@crm-domain',
        instance: '@instance-node',
        origin: 'crm.acme.dev',
        ok: false,
        failure: { message: 'postInstall failed' },
      }),
    })

    await expect(contract.install({})).resolves.toEqual({
      domain: '@crm-domain',
      instance: '@instance-node',
      origin: 'crm.acme.dev',
      ok: false,
      error: 'postInstall failed',
    })
    const sent = contract.calls.at(-1)
    expect(sent?.target).toBe(
      '@instance-node::admin.astrale.ai:class.Instance.method.installDomain',
    )
    const { operationId } = (sent?.value ?? {}) as { operationId?: unknown }
    expect(String(operationId)).toMatch(
      /^cli\.instance\.install-domain\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
  })

  test('rejects malformed install receipts', async () => {
    const malformedInstall = fixture({
      invoke: () => ({
        domain: '@crm-domain',
        instance: '@instance-node',
        origin: 'crm.acme.dev',
        ok: 'yes',
      }),
    })
    await expect(malformedInstall.install()).rejects.toThrow(
      'Admin Domain install outcome is invalid.',
    )

    const malformedInstallPath = fixture({
      invoke: () => ({
        domain: 'not-a-path',
        instance: '@instance-node',
        origin: 'crm.acme.dev',
        ok: true,
      }),
    })
    await expect(malformedInstallPath.install()).rejects.toThrow(
      'Admin Domain reference is invalid.',
    )
  })
})
