import { ResponseError, TransportError } from '@astrale-os/sdk/client'
import { describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AstraleError } from '../../../errors'
import { connectAdminRegistry } from '../client'
import { RegistryError } from '../model'
import {
  BUNDLE_MEDIA_TYPE,
  declared,
  digestOf,
  fakeAdmin,
  publication,
  release,
  REVISION,
  type FakeAdminOptions,
  type FakeDomain,
} from './fake-admin'

const ORIGIN = 'issues.astrale.ai'
const r140 = release('r140')
const r142 = release('r142')
const r143 = release('r143')
const r150 = release('r150')
const r200 = release('r200')

function domain(over: Partial<FakeDomain> = {}): FakeDomain {
  return {
    id: 'domain-issues',
    origin: ORIGIN,
    admins: new Set(['publisher']),
    installers: new Set(['installer']),
    publications: [
      publication('p142', '1.4.2', r142, { yankedAt: '2026-10-01T00:00:00.000Z' }),
      publication('p150', '1.5.0', r150, {
        commit: 'a'.repeat(40),
        verifiedAt: '2026-10-04T11:00:00.000Z',
      }),
      publication('p200rc', '2.0.0-rc.1', r200, { dirty: true }),
      publication('p143', '1.4.3', r143),
      publication('p1100', '1.10.0', r140),
    ],
    ...over,
  }
}

async function thrownBy(promise: Promise<unknown>): Promise<AstraleError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AstraleError)
    return error as AstraleError
  }
  throw new Error('expected a refusal')
}

async function refusalOf(promise: Promise<unknown>): Promise<RegistryError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(RegistryError)
    return error as RegistryError
  }
  throw new Error('expected a refusal')
}

describe('registry index (Résolution [.78020] [.79495])', () => {
  test('an installer reads every version in one Query, highest precedence first', async () => {
    const admin = fakeAdmin({ caller: 'installer', domains: [domain()] })
    const index = await connectAdminRegistry(admin.context).index(ORIGIN)

    expect(index.format).toBe('astrale.registry-index')
    expect(index.version).toBe(1)
    expect(index.origin).toBe(ORIGIN)
    expect(index.publications.map((entry) => entry.version)).toEqual([
      '2.0.0-rc.1',
      '1.10.0',
      '1.5.0',
      '1.4.3',
      '1.4.2',
    ])
    expect(admin.queries).toHaveLength(1)
    expect(admin.calls).toHaveLength(0)
    const [first] = index.publications.filter((entry) => entry.version === '1.5.0')
    expect(first).toEqual({
      version: '1.5.0',
      url: r150.url,
      releaseDigest: r150.releaseDigest,
      buildDigest: r150.buildDigest,
      schemaRevision: REVISION,
      dependencies: [{ origin: 'shell.astrale.ai', revision: REVISION }],
      commit: 'a'.repeat(40),
      dirty: false,
      yanked: false,
      publishedAt: '2026-10-04T10:00:00.000Z',
    })
    const yanked = index.publications.find((entry) => entry.version === '1.4.2')!
    expect(yanked.yanked).toBe(true)
    expect(index.publications.find((entry) => entry.version === '2.0.0-rc.1')!.dirty).toBe(true)
  })

  test('the Query walks Domain -> publication_of_domain and never reads access edges (AM-53)', async () => {
    const admin = fakeAdmin({ caller: 'installer', domains: [domain()] })
    await connectAdminRegistry(admin.context).index(ORIGIN)
    const text = JSON.stringify(admin.queries)
    expect(text).toContain('"name":"Domain"')
    expect(text).toContain('"admin.astrale.ai:class.Domain.property.origin"')
    expect(text).not.toContain('RegisteredDomain')
    expect(text).toContain('"name":"publication_of_domain"')
    expect(text).toContain('"direction":"incoming"')
    expect(text).not.toContain('domain_admin')
    expect(text).not.toContain('domain_installer')
  })

  test('a readable Domain without versions answers an empty index after one more Query', async () => {
    const admin = fakeAdmin({ caller: 'installer', domains: [domain({ publications: [] })] })
    const index = await connectAdminRegistry(admin.context).index(ORIGIN)
    expect(index.publications).toEqual([])
    expect(admin.queries).toHaveLength(2)
  })

  test("a Fleet catalog's member reads the Domain but none of its versions", async () => {
    const admin = fakeAdmin({
      caller: 'fleet-member',
      domains: [domain({ catalogReaders: new Set(['fleet-member']) })],
    })
    const index = await connectAdminRegistry(admin.context).index(ORIGIN)
    expect(index.publications).toEqual([])
    expect(admin.queries).toHaveLength(2)
  })

  test('an unreadable Domain and an absent one are the same refusal', async () => {
    const outsider = fakeAdmin({ caller: 'outsider', domains: [domain()] })
    const hidden = await refusalOf(connectAdminRegistry(outsider.context).index(ORIGIN))
    const absent = await refusalOf(
      connectAdminRegistry(fakeAdmin({ caller: 'installer', domains: [] }).context).index(ORIGIN),
    )
    expect(hidden.code).toBe('REGISTRY_DOMAIN_NOT_FOUND')
    expect({ code: hidden.code, message: hidden.message, details: hidden.details }).toEqual({
      code: absent.code,
      message: absent.message,
      details: absent.details,
    })
  })

  test('an answer this CLI cannot read is never guessed', async () => {
    const admin = fakeAdmin({
      caller: 'installer',
      domains: [domain({ publications: [publication('px', 'v1.0.0', r150)] })],
    })
    const error = await refusalOf(connectAdminRegistry(admin.context).index(ORIGIN))
    expect(error.code).toBe('REGISTRY_UNAVAILABLE')
    expect(error.details).toEqual({ reason: 'response-invalid' })
  })

  test('an Admin that does not answer is REGISTRY_UNAVAILABLE', async () => {
    const admin = fakeAdmin({ caller: 'installer', domains: [domain()] })
    const context = {
      ...admin.context,
      graph: {
        query: async () => {
          throw TransportError.invocation('connect refused', {
            phase: 'connect',
            delivery: 'not-sent',
          })
        },
      },
    }
    const error = await refusalOf(connectAdminRegistry(context as never).index(ORIGIN))
    expect(error.code).toBe('REGISTRY_UNAVAILABLE')
    expect(error.details).toEqual({
      reason: 'transport',
      phase: 'connect',
      delivery: 'not-sent',
      retryable: true,
    })
  })

  test('a read refused with 5001 may be retried; another server refusal may not', async () => {
    const cases: Array<[ResponseError, Record<string, unknown>]> = [
      [
        declared(5001, 'CAPACITY_EXHAUSTED', { retryAfterMs: 1_000 }),
        {
          status: 5001,
          reason: 'CAPACITY_EXHAUSTED',
          retryable: true,
        },
      ],
      [new ResponseError(5000 as never, 'internal', 'inv' as never), { status: 5000 }],
    ]
    for (const [cause, details] of cases) {
      const admin = fakeAdmin({ caller: 'installer', domains: [domain()] })
      const context = {
        ...admin.context,
        graph: {
          query: async () => {
            throw cause
          },
        },
      }
      const error = await refusalOf(connectAdminRegistry(context as never).index(ORIGIN))
      expect({ code: error.code, details: error.details }).toEqual({
        code: 'REGISTRY_UNAVAILABLE',
        details,
      })
    }
  })
})

describe('registry publish (Registry [.119344], CT27 publish)', () => {
  const request = (version: string, source = r150, extra: Record<string, unknown> = {}) => ({
    format: 'astrale.registry-publish-request' as const,
    version: 1 as const,
    publication: {
      origin: ORIGIN,
      version,
      url: source.url,
      releaseDigest: source.releaseDigest as `sha256:${string}`,
      dirty: false,
      ...extra,
    },
  })

  test('creates, then answers unchanged for the same release, then refuses another one', async () => {
    const admin = fakeAdmin({
      caller: 'publisher',
      domains: [domain({ publications: [] })],
      releases: [r150, r200],
    })
    const registry = connectAdminRegistry(admin.context)

    const created = await registry.publish(request('1.6.0', r150, { commit: 'B'.repeat(40) }))
    expect(created.format).toBe('astrale.registry-publish-result')
    expect(created.status).toBe('created')
    expect(created.retention).toBe('marked')
    expect(created.publication.commit).toBe('b'.repeat(40))
    expect(admin.calls[0]).toEqual({
      target: '@domain-issues::admin.astrale.ai:class.Domain.method.publish',
      input: {
        version: '1.6.0',
        deploymentUrl: r150.url,
        releaseDigest: r150.releaseDigest,
        commit: 'B'.repeat(40),
      },
    })

    const again = await registry.publish(request('1.6.0', r150))
    expect(again.status).toBe('unchanged')
    expect(again.retention).toBe('marked')
    expect(again.publication).toEqual(created.publication)

    const conflict = await refusalOf(registry.publish(request('1.6.0', r200)))
    expect(conflict.code).toBe('PUBLICATION_VERSION_CONFLICT')
    expect(conflict.details).toEqual({ existing: created.publication })
  })

  test("Admin's retention mark is passed through; an unknown one is never guessed", async () => {
    for (const retention of ['failed', 'not-applicable'] as const) {
      const admin = fakeAdmin({
        caller: 'publisher',
        domains: [domain({ publications: [] })],
        releases: [r150],
        retention,
      })
      const result = await connectAdminRegistry(admin.context).publish(request('1.6.0'))
      expect({ status: result.status, retention: result.retention }).toEqual({
        status: 'created',
        retention,
      })
    }
    const admin = fakeAdmin({
      caller: 'publisher',
      domains: [domain({ publications: [] })],
      releases: [r150],
      retention: 'pending' as never,
    })
    const error = await refusalOf(connectAdminRegistry(admin.context).publish(request('1.6.0')))
    expect({ code: error.code, details: error.details }).toEqual({
      code: 'REGISTRY_UNAVAILABLE',
      details: { reason: 'response-invalid' },
    })
  })

  test('a dirty build is sent as dirty: true', async () => {
    const admin = fakeAdmin({
      caller: 'publisher',
      domains: [domain({ publications: [] })],
      releases: [r150],
    })
    const result = await connectAdminRegistry(admin.context).publish(
      request('1.6.0', r150, { dirty: true }),
    )
    expect((admin.calls[0]!.input as Record<string, unknown>).dirty).toBe(true)
    expect(result.publication.dirty).toBe(true)
  })

  test('only a domain_admin publishes; an installer is REGISTRY_FORBIDDEN, an outsider sees no Domain', async () => {
    const admin = fakeAdmin({ caller: 'installer', domains: [domain()], releases: [r150] })
    const registry = connectAdminRegistry(admin.context)
    expect((await refusalOf(registry.publish(request('1.6.0')))).code).toBe('REGISTRY_FORBIDDEN')
    admin.as('outsider')
    const hidden = await refusalOf(registry.publish(request('1.6.0')))
    expect(hidden.code).toBe('REGISTRY_DOMAIN_NOT_FOUND')
    expect(admin.calls).toHaveLength(1)
  })

  test("Admin's release refusals keep their meaning", async () => {
    const cases: Array<[unknown, string, Record<string, unknown>]> = [
      [
        declared(4001, 'RELEASE_DIGEST_MISMATCH', { expected: 'sha256:a', served: 'sha256:b' }),
        'PUBLICATION_RELEASE_MISMATCH',
        { expected: 'sha256:a', served: 'sha256:b' },
      ],
      [
        declared(1003, 'RELEASE_INVALID', { reason: 'deployment-label-invalid' }),
        'PUBLICATION_RELEASE_MISMATCH',
        { reason: 'deployment-label-invalid' },
      ],
      [
        declared(1003, 'RELEASE_INVALID', { reason: 'bundle-absent' }),
        'PUBLICATION_RELEASE_UNREACHABLE',
        { reason: 'bundle-absent' },
      ],
      [
        declared(5001, 'RELEASE_UNAVAILABLE', { reason: 'timeout' }),
        'PUBLICATION_RELEASE_UNREACHABLE',
        { retryable: true, reason: 'timeout' },
      ],
      [
        declared(1003, 'VERSION_INVALID', { version: '1.6.0' }),
        'PUBLICATION_VERSION_INVALID',
        { version: '1.6.0' },
      ],
      [
        // A concurrent change failed Admin's one guarded commit; a rerun decides again.
        declared(4001, 'DOMAIN_CONFLICT', { reason: 'changed-concurrently' }),
        'REGISTRY_UNAVAILABLE',
        { retryable: true, reason: 'changed-concurrently' },
      ],
      [
        // A commit the Kernel did not submit: Admin's retryable BACKEND_UNAVAILABLE whose reason
        // is the Kernel's submission code; nothing was written.
        declared(5001, 'MUTATION_CAPACITY_EXHAUSTED', {}),
        'REGISTRY_UNAVAILABLE',
        { status: 5001, reason: 'MUTATION_CAPACITY_EXHAUSTED', retryable: true },
      ],
      [
        // A call the Kernel did not admit: nothing ran.
        declared(5001, 'SERVER_DRAINING', { retryAfterMs: 1_000 }),
        'REGISTRY_UNAVAILABLE',
        { status: 5001, reason: 'SERVER_DRAINING', retryable: true },
      ],
      [
        // Any other server refusal of a change, such as a lost commit Admin could not settle.
        new ResponseError(5001 as never, 'down', 'inv' as never),
        'REGISTRY_UNAVAILABLE',
        { status: 5001, delivery: 'unknown', retryable: true },
      ],
      [
        new ResponseError(5000 as never, 'outcome is unknown', 'inv' as never),
        'REGISTRY_UNAVAILABLE',
        { status: 5000, delivery: 'unknown', retryable: true },
      ],
      [
        // A request this CLI built and the Kernel refused: a rerun cannot help.
        new ResponseError(4001 as never, 'invalid', 'inv' as never),
        'REGISTRY_UNAVAILABLE',
        { status: 4001 },
      ],
    ]
    for (const [cause, code, details] of cases) {
      const admin = fakeAdmin({
        caller: 'publisher',
        domains: [domain({ publications: [] })],
        publishRefusal: () => cause,
      })
      const error = await refusalOf(connectAdminRegistry(admin.context).publish(request('1.6.0')))
      expect({ code: error.code, details: error.details }).toEqual({ code, details })
    }
  })

  test('a change whose outcome Admin cannot settle says it may have applied', async () => {
    const admin = fakeAdmin({
      caller: 'publisher',
      domains: [domain({ publications: [] })],
      publishRefusal: () => new ResponseError(5000 as never, 'outcome is unknown', 'inv' as never),
    })
    const error = await refusalOf(connectAdminRegistry(admin.context).publish(request('1.6.0')))
    expect(error.message).toContain('the change may have applied')
    expect(error.message).toContain('Rerun the same command')
  })

  test('a deployment Admin cannot find is PUBLICATION_RELEASE_UNREACHABLE', async () => {
    const admin = fakeAdmin({ caller: 'publisher', domains: [domain({ publications: [] })] })
    const error = await refusalOf(connectAdminRegistry(admin.context).publish(request('1.6.0')))
    expect(error.code).toBe('PUBLICATION_RELEASE_UNREACHABLE')
    expect(error.details).toEqual({ reason: 'release-absent' })
  })

  test('a lost reply says the change may have applied and that a rerun is safe', async () => {
    const admin = fakeAdmin({ caller: 'publisher', domains: [domain({ publications: [] })] })
    const context = {
      ...admin.context,
      session: {
        ...admin.context.session,
        call: async () => {
          throw TransportError.invocation('reset', { phase: 'receive', delivery: 'unknown' })
        },
      },
    }
    const error = await refusalOf(connectAdminRegistry(context as never).publish(request('1.6.0')))
    expect(error.code).toBe('REGISTRY_UNAVAILABLE')
    expect(error.message).toContain('Rerun the same command')
    expect(error.details).toEqual({
      reason: 'transport',
      phase: 'receive',
      delivery: 'unknown',
      retryable: true,
    })
  })
})

describe('registry yank (Versioning [.74285] [.72368])', () => {
  test('yank changes once, then answers unchanged; --undo puts the version back', async () => {
    const admin = fakeAdmin({ caller: 'publisher', domains: [domain()] })
    const registry = connectAdminRegistry(admin.context)

    const yanked = await registry.yank(ORIGIN, '1.5.0')
    expect(yanked.format).toBe('astrale.registry-yank-result')
    expect(yanked.status).toBe('changed')
    expect(yanked.publication.yanked).toBe(true)
    expect(admin.calls.at(-1)).toEqual({
      target: '@p150::admin.astrale.ai:class.Publication.method.yank',
      input: {},
    })

    expect((await registry.yank(ORIGIN, '1.5.0')).status).toBe('unchanged')

    const restored = await registry.yank(ORIGIN, '1.5.0', { undo: true })
    expect(restored.status).toBe('changed')
    expect(restored.publication.yanked).toBe(false)
    expect(admin.calls.at(-1)!.target).toBe(
      '@p150::admin.astrale.ai:class.Publication.method.unyank',
    )
    expect((await registry.yank(ORIGIN, '1.5.0', { undo: true })).status).toBe('unchanged')
  })

  test('an installer is REGISTRY_FORBIDDEN; an unknown version or Domain is not found', async () => {
    const admin = fakeAdmin({ caller: 'installer', domains: [domain()] })
    const registry = connectAdminRegistry(admin.context)
    expect((await refusalOf(registry.yank(ORIGIN, '1.5.0'))).code).toBe('REGISTRY_FORBIDDEN')

    const missing = await refusalOf(registry.yank(ORIGIN, '9.9.9'))
    expect(missing.code).toBe('PUBLICATION_NOT_FOUND')
    expect(missing.details).toEqual({ origin: ORIGIN, version: '9.9.9' })

    admin.as('outsider')
    expect((await refusalOf(registry.yank(ORIGIN, '1.5.0'))).code).toBe('REGISTRY_DOMAIN_NOT_FOUND')
  })
})

describe('registry bundle: read from the published deployment (AM-241)', () => {
  const output = () => join(mkdtempSync(join(tmpdir(), 'astrale-registry-bundle-')), 'bundle.json')
  const deployed = (over: Partial<FakeAdminOptions>) =>
    fakeAdmin({ caller: 'installer', domains: [domain()], releases: [r150], ...over })

  test("writes the bundle the deployment's release describes once its digest matches", async () => {
    const admin = deployed({})
    const file = output()
    const result = await connectAdminRegistry(admin.context).bundle(ORIGIN, '1.5.0', file)
    expect(result).toEqual({
      format: 'astrale.registry-bundle',
      version: 1,
      publication: { origin: ORIGIN, version: '1.5.0' },
      bundle: {
        digest: digestOf(r150.bytes),
        mediaType: BUNDLE_MEDIA_TYPE,
        size: r150.bytes.length,
      },
    })
    expect(Buffer.from(readFileSync(file)).equals(Buffer.from(r150.bytes))).toBe(true)
    // One Admin Query for the Publication, then the deployment's release and its bundle, in
    // place: no Admin download, no redirect followed.
    expect(admin.queries).toHaveLength(1)
    expect(admin.calls).toEqual([])
    expect(admin.fetches).toEqual([
      { url: `${r150.url}/.well-known/astrale/release.json`, redirect: 'manual' },
      { url: r150.document.schema.bundle.href, redirect: 'manual' },
    ])
    expect(readdirSync(join(file, '..'))).toEqual(['bundle.json'])
  })

  test('a file that takes fewer bytes than it is given still receives the whole bundle', async () => {
    // Every write takes at most 3 bytes: the bundle must still reach the file whole.
    const probe = await open(join(mkdtempSync(join(tmpdir(), 'astrale-registry-probe-')), 'p'), 'w')
    const handle = Object.getPrototypeOf(probe) as FileHandle
    await probe.close()
    const write = handle.write as (
      this: FileHandle,
      buffer: Uint8Array,
      offset: number,
      length: number,
    ) => ReturnType<FileHandle['write']>
    const short = spyOn(handle, 'write').mockImplementation(function (
      this: FileHandle,
      buffer: Uint8Array,
      offset = 0,
      length = buffer.byteLength - offset,
    ) {
      return write.call(this, buffer, offset, Math.min(length, 3))
    } as FileHandle['write'])
    try {
      const file = output()
      await connectAdminRegistry(deployed({}).context).bundle(ORIGIN, '1.5.0', file)
      expect(Buffer.from(readFileSync(file)).equals(Buffer.from(r150.bytes))).toBe(true)
      expect(short.mock.calls.length).toBeGreaterThan(2)
    } finally {
      short.mockRestore()
    }
  })

  test('bundle bytes whose digest does not match the release never take the output name', async () => {
    const admin = deployed({ servedBytes: new TextEncoder().encode('{"bundle":"r15x"}') })
    const file = output()
    const error = await refusalOf(connectAdminRegistry(admin.context).bundle(ORIGIN, '1.5.0', file))
    expect({ code: error.code, details: error.details }).toEqual({
      code: 'PUBLICATION_RELEASE_MISMATCH',
      details: {
        reason: 'bundle-mismatch',
        expected: { digest: digestOf(r150.bytes), size: r150.bytes.length },
        served: { digest: digestOf(new TextEncoder().encode('{"bundle":"r15x"}')), size: 17 },
      },
    })
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(join(file, '..'))).toEqual([])
  })

  test('bytes beyond the described size stop the read and are refused', async () => {
    const admin = deployed({ servedBytes: new TextEncoder().encode('x'.repeat(4_096)) })
    const file = output()
    const error = await refusalOf(connectAdminRegistry(admin.context).bundle(ORIGIN, '1.5.0', file))
    expect(error.code).toBe('PUBLICATION_RELEASE_MISMATCH')
    expect(error.details).toMatchObject({ reason: 'bundle-mismatch', oversized: true })
    expect(readdirSync(join(file, '..'))).toEqual([])
  })

  test('a deployment serving another release than the Publication names is refused before its bundle', async () => {
    const admin = deployed({ servedRelease: r200.document })
    const file = output()
    const error = await refusalOf(connectAdminRegistry(admin.context).bundle(ORIGIN, '1.5.0', file))
    expect({ code: error.code, details: error.details }).toEqual({
      code: 'PUBLICATION_RELEASE_MISMATCH',
      details: { expected: r150.releaseDigest, served: r200.releaseDigest },
    })
    expect(admin.fetches).toHaveLength(1)
    expect(readdirSync(join(file, '..'))).toEqual([])
  })

  test("a deployment's other answers get publish's refusals", async () => {
    const cases: Array<[Partial<FakeAdminOptions>, string, Record<string, unknown>]> = [
      [{ releases: [] }, 'PUBLICATION_RELEASE_UNREACHABLE', { reason: 'release-absent' }],
      [
        { deploymentStatus: 503 },
        'PUBLICATION_RELEASE_UNREACHABLE',
        { reason: 'http-503', retryable: true },
      ],
      [
        { deploymentStatus: 302 },
        'PUBLICATION_RELEASE_MISMATCH',
        { reason: 'release-document-invalid' },
      ],
      [
        { servedRelease: { ...r150.document, digest: r200.releaseDigest } },
        'PUBLICATION_RELEASE_MISMATCH',
        { reason: 'release-document-invalid' },
      ],
    ]
    for (const [over, code, details] of cases) {
      const file = output()
      const error = await refusalOf(
        connectAdminRegistry(deployed(over).context).bundle(ORIGIN, '1.5.0', file),
      )
      expect({ code: error.code, details: error.details }).toEqual({ code, details })
      expect(readdirSync(join(file, '..'))).toEqual([])
    }
  })

  test('a deployment that does not answer may be retried', async () => {
    const admin = deployed({})
    const context = {
      ...admin.context,
      deployment: {
        timeoutMs: 5_000,
        fetch: async () => {
          throw new TypeError('fetch failed')
        },
      },
    }
    const file = output()
    const error = await refusalOf(connectAdminRegistry(context).bundle(ORIGIN, '1.5.0', file))
    expect({ code: error.code, details: error.details }).toEqual({
      code: 'PUBLICATION_RELEASE_UNREACHABLE',
      details: { reason: 'network', retryable: true },
    })
    expect(readdirSync(join(file, '..'))).toEqual([])
  })

  test("an output that cannot be written is the caller's error, found before any read", async () => {
    const admin = deployed({})
    const registry = connectAdminRegistry(admin.context)
    const root = mkdtempSync(join(tmpdir(), 'astrale-registry-bundle-'))

    const missing = await thrownBy(registry.bundle(ORIGIN, '1.5.0', join(root, 'none', 'b.json')))
    expect(missing).toBeInstanceOf(AstraleError)
    expect(missing).not.toBeInstanceOf(RegistryError)
    expect(missing.code).toBe('FILE_WRITE_FAILED')
    expect(missing.message).toContain('(ENOENT)')

    const directory = await thrownBy(registry.bundle(ORIGIN, '1.5.0', root))
    expect(directory.code).toBe('FILE_WRITE_FAILED')
    expect(directory.message).toContain('(EISDIR)')

    expect(admin.fetches).toEqual([])
    expect(readdirSync(root)).toEqual([])
  })

  test('only a reader of the Publication learns its deployment', async () => {
    const outsider = deployed({ caller: 'outsider' })
    const hidden = await refusalOf(
      connectAdminRegistry(outsider.context).bundle(ORIGIN, '1.5.0', output()),
    )
    expect(hidden.code).toBe('REGISTRY_DOMAIN_NOT_FOUND')

    const member = deployed({
      caller: 'fleet-member',
      domains: [domain({ catalogReaders: new Set(['fleet-member']) })],
    })
    const unread = await refusalOf(
      connectAdminRegistry(member.context).bundle(ORIGIN, '1.5.0', output()),
    )
    expect(unread.code).toBe('PUBLICATION_NOT_FOUND')
    expect([...outsider.fetches, ...member.fetches]).toEqual([])
  })
})
