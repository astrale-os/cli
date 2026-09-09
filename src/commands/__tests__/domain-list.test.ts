import { defineSchema, schema as schemaApi } from '@astrale-os/sdk/schema'
import { afterAll, describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import type { DomainInfo } from '../../lib/admin-domain'

import { releaseFor } from '../../__tests__/fixtures/publication'
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
    const deployed = releaseFor(schema, 'https://catalog-check.example.dev').publication
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
      schemaRevision: schemaApi.revision(schema),
      checkError: null,
    })
  })

  test('rejects a Publication whose origin differs from the catalog entry', async () => {
    const schema = defineSchema('deployed.example.dev', {})
    const deployed = releaseFor(schema, 'https://deployed.example.dev').publication
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

describe('domain list — command failures', () => {
  // Isolate the dependency replacement from other commands sharing the catalog module.
  function run(failure: string, debug = false) {
    return Bun.spawnSync(
      [
        process.execPath,
        '-e',
        `
      import { mock } from 'bun:test'
      import { ResponseError } from '@astrale-os/sdk/client'
      globalThis.fetch = async () => { throw new Error('Unexpected network access') }
      mock.module(${JSON.stringify(fileURLToPath(new URL('../../lib/admin-domain.ts', import.meta.url)))}, () => ({
        listAdminDomains: async () => { throw ${failure} },
      }))
      const { default: command } = await import(${JSON.stringify(fileURLToPath(new URL('../domain/list.ts', import.meta.url)))})
      await command.action({ json: true, debug: ${debug} })
    `,
      ],
      { cwd: fileURLToPath(new URL('../../../', import.meta.url)), stdout: 'pipe', stderr: 'pipe' },
    )
  }

  test('retains a known Query rejection and its admitted reason in machine output', () => {
    const result = run(
      `new ResponseError(1003, 'Query input is invalid.', { source: 'https://admin.test', id: 'catalog-list' }, { code: 'QUERY_INPUT_INVALID', details: { phase: 'plan', issue: 'QUERY_DEFINITION_UNRESOLVED', path: '/source/terms/0' } })`,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toBe('')
    expect(JSON.parse(result.stderr.toString())).toEqual({
      error: 'RESPONSE_ERROR',
      code: 1003,
      message: 'Query input is invalid.',
      reason: {
        code: 'QUERY_INPUT_INVALID',
        details: { phase: 'plan', issue: 'QUERY_DEFINITION_UNRESOLVED', path: '/source/terms/0' },
      },
    })
  })

  test.each([false, true])('exposes internal diagnostics only with debug=%s', (debug) => {
    const result = run(`new Error('catalog diagnostic detail')`, debug)
    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toBe('')
    const stderr = result.stderr.toString()
    expect(JSON.parse(stderr.split('\n')[0]!)).toEqual({
      error: 'UNEXPECTED_ERROR',
      message: 'The CLI encountered an unexpected internal failure.',
    })
    expect(stderr.includes('catalog diagnostic detail')).toBe(debug)
  })
})
