import { defineDomain } from '@astrale-os/sdk'
import { issuer } from '@astrale-os/sdk/auth'
import { createDeployment } from '@astrale-os/sdk/deployment'
import { defineSchema } from '@astrale-os/sdk/schema/v1'
import { afterAll, describe, expect, test } from 'bun:test'

import type { DomainInfo } from '../../lib/admin-domain'

import { byDefaultThenName, domainProjection, probe, type DomainRow } from '../domain/list'

const strip = (s: string): string => s.replace(/\[[0-9;]*m/g, '')

function entry(over: Partial<DomainInfo>): DomainInfo {
  return {
    id: over.origin ?? 'id',
    origin: 'x.astrale.ai',
    name: 'x',
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

describe('domain list — ordering', () => {
  test('install-by-default sorts first, then alphabetical by origin', () => {
    const rows = [
      entry({ origin: 'zeta.astrale.ai' }),
      entry({ origin: 'alpha.astrale.ai' }),
      entry({ origin: 'mid.astrale.ai', installByDefault: true }),
      entry({ origin: 'beta.astrale.ai', installByDefault: true }),
    ]
    rows.sort(byDefaultThenName)
    expect(rows.map((r) => r.origin)).toEqual([
      'beta.astrale.ai', // default group, alpha order
      'mid.astrale.ai',
      'alpha.astrale.ai', // non-default group, alpha order
      'zeta.astrale.ai',
    ])
  })
})

describe('domain list — projection', () => {
  test('row carries name/origin/url and a default marker; -q paths are install urls', () => {
    const proj = domainProjection([
      entry({
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
        installByDefault: true,
      }),
    ])
    const row = proj.rows[0]
    expect(strip(row.name)).toBe('crm')
    expect(strip(row.origin)).toBe('crm.acme.dev')
    expect(strip(row.url)).toBe('https://crm.acme.dev')
    expect(strip(row.default)).toBe('default')
    // The quiet/pipeable token is the install URL, not the origin.
    expect(proj.paths).toEqual(['https://crm.acme.dev'])
  })

  test('an unpublished entry shows a placeholder url and falls back to origin for -q', () => {
    const proj = domainProjection([entry({ origin: 'pending.dev', name: 'pending' })])
    expect(strip(proj.rows[0].url)).toBe('(unpublished)')
    expect(strip(proj.rows[0].default)).toBe('')
    expect(proj.paths).toEqual(['pending.dev'])
  })

  test('STATUS cell is empty without --check, live/down with it', () => {
    const base = entry({ origin: 'a.dev', url: 'https://a.dev' })
    expect(strip(domainProjection([base]).rows[0].status)).toBe('')

    const live: DomainRow = { ...base, reachable: true, checkError: null }
    expect(strip(domainProjection([live]).rows[0].status)).toBe('● live')

    const down: DomainRow = { ...base, reachable: false, checkError: 'Publication HTTP 502' }
    expect(strip(domainProjection([down]).rows[0].status)).toBe('○ Publication HTTP 502')
  })
})

describe('domain list — canonical Publication check', () => {
  const servers: { stop(): void }[] = []
  afterAll(() => {
    for (const server of servers) server.stop()
  })

  test('reports the admitted schema revision in machine data', async () => {
    const schema = defineSchema('catalog-check.example.dev', {})
    const definition = defineDomain({
      schema,
      handlers: { functions: {}, classes: {}, interfaces: {} },
    })
    const deployed = createDeployment({
      definition,
      issuer: issuer.accept('https://catalog-check.example.dev'),
      bundleHref: 'https://catalog-check.example.dev/domain.bundle.json',
      bindings: { callables: [] },
    }).publication
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        return new URL(request.url).pathname === '/.well-known/astrale/domain.json'
          ? Response.json(deployed)
          : new Response('not found', { status: 404 })
      },
    })
    servers.push(server)

    await expect(
      probe(
        entry({
          origin: schema.origin,
          url: `http://localhost:${server.port}`,
        }),
      ),
    ).resolves.toMatchObject({
      reachable: true,
      schemaRevision: definition.domain.$.revision,
      checkError: null,
    })
  })

  test('rejects a Publication whose origin differs from the catalog entry', async () => {
    const schema = defineSchema('deployed.example.dev', {})
    const definition = defineDomain({
      schema,
      handlers: { functions: {}, classes: {}, interfaces: {} },
    })
    const deployed = createDeployment({
      definition,
      issuer: issuer.accept('https://deployed.example.dev'),
      bundleHref: 'https://deployed.example.dev/domain.bundle.json',
      bindings: { callables: [] },
    }).publication
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json(deployed),
    })
    servers.push(server)

    await expect(
      probe(
        entry({
          origin: 'catalog.example.dev',
          url: `http://localhost:${server.port}`,
        }),
      ),
    ).resolves.toMatchObject({
      reachable: false,
      checkError:
        'Domain origin mismatch: deployed=deployed.example.dev expected=catalog.example.dev',
    })
  })
})
