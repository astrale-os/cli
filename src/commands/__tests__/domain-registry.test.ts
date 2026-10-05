import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AdminRegistryApi, RegistryIndexV1 } from '../../admin/registry'
import type { RegistryCommandDependencies } from '../domain-registry/shared'

import { connectAdminRegistry } from '../../admin/registry'
import {
  digestOf,
  fakeAdmin,
  publication,
  release,
  type FakeAdminOptions,
  type FakeDomain,
} from '../../admin/registry/__tests__/fake-admin'
import { runBundle } from '../domain-registry/bundle'
import { runPublish } from '../domain-registry/publish'
import { readRequest } from '../domain-registry/shared'
import { runYank } from '../domain-registry/yank'
import { renderVersions, runVersions, versionRows } from '../domain/versions'

const ORIGIN = 'issues.astrale.ai'
const r150 = release('r150')
const r142 = release('r142')
const r200 = release('r200')

function domain(): FakeDomain {
  return {
    id: 'domain-issues',
    origin: ORIGIN,
    admins: new Set(['publisher']),
    installers: new Set(['installer']),
    publications: [
      publication('p150', '1.5.0', r150),
      publication('p142', '1.4.2', r142, { yankedAt: '2026-10-01T00:00:00.000Z' }),
      publication('p200rc', '2.0.0-rc.1', r200),
    ],
  }
}

/** A command run against the fake Admin: what it printed and whether it opened Admin at all. */
function harness(
  caller: string,
  domains: FakeDomain[] = [domain()],
  over: Partial<FakeAdminOptions> = {},
) {
  const admin = fakeAdmin({ caller, domains, releases: [r150], ...over })
  const written: string[] = []
  let opened = 0
  const dependencies: RegistryCommandDependencies = {
    open: async <Value>(_opts: unknown, work: (registry: AdminRegistryApi) => Promise<Value>) => {
      opened += 1
      return work(connectAdminRegistry(admin.context))
    },
    write: (text) => written.push(text),
  }
  return {
    admin,
    dependencies,
    stdout: () => JSON.parse(written.join('')) as Record<string, unknown>,
    opened: () => opened,
  }
}

describe('astrale domain versions', () => {
  test('--json prints one astrale.registry-index document and exits 0', async () => {
    const run = harness('installer')
    expect(await runVersions(ORIGIN, { json: true }, run.dependencies)).toBe(0)
    const index = run.stdout() as unknown as RegistryIndexV1
    expect(index.format).toBe('astrale.registry-index')
    expect(index.publications.map((entry) => entry.version)).toEqual([
      '2.0.0-rc.1',
      '1.5.0',
      '1.4.2',
    ])
  })

  test('a refusal is one error document on stdout and exit 1', async () => {
    const run = harness('outsider')
    expect(await runVersions(ORIGIN, { json: true }, run.dependencies)).toBe(1)
    expect(run.stdout()).toEqual({
      error: {
        code: 'REGISTRY_DOMAIN_NOT_FOUND',
        message: expect.stringContaining(ORIGIN),
        details: { origin: ORIGIN },
      },
    })
  })

  test('an argument that is no origin is refused before Admin is opened', async () => {
    const run = harness('installer')
    expect(await runVersions('issues.astrale.ai@1.5', { json: true }, run.dependencies)).toBe(1)
    expect((run.stdout().error as { code: string }).code).toBe('INVALID_ARGUMENT')
    expect(run.opened()).toBe(0)
  })

  test('the human table follows Résolution [.79737]', async () => {
    const admin = fakeAdmin({ caller: 'installer', domains: [domain()] })
    const index = await connectAdminRegistry(admin.context).index(ORIGIN)
    expect(versionRows(index)).toEqual([
      {
        version: '2.0.0-rc.1',
        digest: `${r200.releaseDigest.slice(0, 19)}…`,
        status: 'pre-release',
      },
      { version: '1.5.0', digest: `${r150.releaseDigest.slice(0, 19)}…`, status: '' },
      { version: '1.4.2', digest: `${r142.releaseDigest.slice(0, 19)}…`, status: 'yanked' },
    ])
    const plain = renderVersions(index).replace(/\[[0-9;]*m/gu, '')
    expect(plain.split('\n')).toHaveLength(3)
    expect(plain).toContain('1.4.2')
    expect(renderVersions({ ...index, publications: [] })).toContain(
      'has no published version readable by this caller',
    )
  })
})

describe('astrale __domain-registry', () => {
  test('publish reads one request on stdin and prints the publish result', async () => {
    const run = harness('publisher')
    const code = await runPublish(
      {},
      {
        ...run.dependencies,
        request: async () => ({
          format: 'astrale.registry-publish-request',
          version: 1,
          publication: {
            origin: ORIGIN,
            version: '1.6.0',
            url: r150.url,
            releaseDigest: r150.releaseDigest,
            dirty: false,
          },
        }),
      },
    )
    expect(code).toBe(0)
    expect(run.stdout()).toMatchObject({
      format: 'astrale.registry-publish-result',
      version: 1,
      status: 'created',
      publication: { version: '1.6.0', releaseDigest: r150.releaseDigest },
      retention: 'marked',
    })
    expect(run.stdout().publication).not.toHaveProperty('bundle')
  })

  test('a malformed request costs no Admin request', async () => {
    const run = harness('publisher')
    const code = await runPublish(
      {},
      { ...run.dependencies, request: async () => ({ format: 'x' }) },
    )
    expect(code).toBe(1)
    expect((run.stdout().error as { code: string }).code).toBe('INVALID_INPUT')
    expect(run.opened()).toBe(0)
  })

  test('yank names one exact version; a line is refused before Admin is opened', async () => {
    const run = harness('publisher')
    expect(await runYank(`${ORIGIN}@1.5.0`, {}, run.dependencies)).toBe(0)
    expect(run.stdout()).toMatchObject({ status: 'changed', publication: { yanked: true } })

    const line = harness('publisher')
    expect(await runYank(`${ORIGIN}@1.5`, {}, line.dependencies)).toBe(1)
    expect((line.stdout().error as { code: string }).code).toBe('PUBLICATION_VERSION_INVALID')
    expect(line.opened()).toBe(0)
  })

  test('yank --undo prints the restored Publication', async () => {
    const run = harness('publisher')
    expect(await runYank(`${ORIGIN}@1.4.2`, { undo: true }, run.dependencies)).toBe(0)
    expect(run.stdout()).toMatchObject({ status: 'changed', publication: { yanked: false } })
  })

  test('bundle writes the verified bundle from the deployment and prints its descriptor', async () => {
    const run = harness('installer')
    const output = join(mkdtempSync(join(tmpdir(), 'astrale-registry-command-')), 'bundle.json')
    expect(await runBundle(`${ORIGIN}@1.5.0`, { output }, run.dependencies)).toBe(0)
    expect(run.stdout()).toEqual({
      format: 'astrale.registry-bundle',
      version: 1,
      publication: { origin: ORIGIN, version: '1.5.0' },
      bundle: {
        digest: digestOf(r150.bytes),
        mediaType: 'application/vnd.astrale.domain-bundle+json;v=1',
        size: r150.bytes.length,
      },
    })
    expect(Buffer.from(readFileSync(output)).equals(Buffer.from(r150.bytes))).toBe(true)
  })

  test('bundle refuses bytes whose digest the release does not name, writing nothing', async () => {
    const run = harness('installer', [domain()], {
      servedBytes: new TextEncoder().encode('{"bundle":"r15x"}'),
    })
    const directory = mkdtempSync(join(tmpdir(), 'astrale-registry-command-'))
    const output = join(directory, 'bundle.json')
    expect(await runBundle(`${ORIGIN}@1.5.0`, { output }, run.dependencies)).toBe(1)
    expect(run.stdout()).toMatchObject({
      error: { code: 'PUBLICATION_RELEASE_MISMATCH', details: { reason: 'bundle-mismatch' } },
    })
    expect(readdirSync(directory)).toEqual([])
  })

  test('bundle requires --output before any request', async () => {
    const run = harness('installer')
    expect(await runBundle(`${ORIGIN}@1.5.0`, {}, run.dependencies)).toBe(1)
    expect((run.stdout().error as { code: string }).code).toBe('MISSING_ARG')
    expect(run.opened()).toBe(0)
  })

  test('the request reader refuses a terminal, oversize input and invalid JSON', async () => {
    const chunks = (values: string[], isTTY = false) =>
      Object.assign(
        (async function* () {
          yield* values
        })(),
        { isTTY },
      )
    expect(await readRequest(chunks(['{"a":', '1}']))).toEqual({ a: 1 })
    await expect(readRequest(chunks([], true))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(readRequest(chunks(['x'.repeat(20)]), 10)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(readRequest(chunks(['{']))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
