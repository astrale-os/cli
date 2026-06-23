import { afterAll, describe, expect, test } from 'bun:test'

import installCommand, {
  domainRefFromTarget,
  isIdentityOverride,
  isSchemaHashMismatch,
  probeDeclaredOrigin,
  retryOnSchemaHashMismatch,
} from '../domain/install'

describe('install command options', () => {
  test('exposes --expected-schema-hash so deploy tooling can pin the build', () => {
    const flags = (installCommand.options ?? []).map((o) => o.flags)
    expect(flags).toContain('--expected-schema-hash <hash>')
  })
})

describe('retryOnSchemaHashMismatch', () => {
  test('retries a not-yet-propagated build, then resolves, backing off (capped, exponential)', async () => {
    const sleeps: number[] = []
    let calls = 0
    const result = await retryOnSchemaHashMismatch(
      async () => {
        calls++
        if (calls < 3) throw new Error('Domain install failed: SCHEMA_HASH_MISMATCH: stale')
        return 'installed'
      },
      {
        enabled: true,
        sleep: async (ms) => void sleeps.push(ms),
        baseBackoffMs: 100,
        maxBackoffMs: 1000,
      },
    )
    expect(result).toBe('installed')
    expect(calls).toBe(3)
    expect(sleeps).toEqual([100, 200])
  })

  test('does not retry a non-mismatch error', async () => {
    let calls = 0
    await expect(
      retryOnSchemaHashMismatch(
        async () => {
          calls++
          throw new Error('PERMISSION_DENIED')
        },
        { enabled: true, sleep: async () => undefined },
      ),
    ).rejects.toThrow(/PERMISSION_DENIED/)
    expect(calls).toBe(1)
  })

  test('a single attempt when not pinned (disabled)', async () => {
    let calls = 0
    await expect(
      retryOnSchemaHashMismatch(
        async () => {
          calls++
          throw new Error('SCHEMA_HASH_MISMATCH: stale')
        },
        { enabled: false, sleep: async () => undefined },
      ),
    ).rejects.toThrow(/SCHEMA_HASH_MISMATCH/)
    expect(calls).toBe(1)
  })

  test('gives up after exhausting attempts, still surfacing the mismatch', async () => {
    await expect(
      retryOnSchemaHashMismatch(
        async () => Promise.reject(new Error('SCHEMA_HASH_MISMATCH: still stale')),
        {
          enabled: true,
          attempts: 2,
          sleep: async () => undefined,
          baseBackoffMs: 1,
          maxBackoffMs: 1,
        },
      ),
    ).rejects.toThrow(/SCHEMA_HASH_MISMATCH/)
  })

  test('isSchemaHashMismatch matches the kernel marker only', () => {
    expect(isSchemaHashMismatch(new Error('Domain install failed: SCHEMA_HASH_MISMATCH: x'))).toBe(
      true,
    )
    expect(isSchemaHashMismatch(new Error('credential graph_hash does not match expected'))).toBe(
      false,
    )
  })
})

describe('admin-path target classification', () => {
  test('an http(s) url installs by url', () => {
    expect(domainRefFromTarget('https://crm.acme.dev')).toEqual({ url: 'https://crm.acme.dev' })
    expect(domainRefFromTarget('http://localhost:8787')).toEqual({ url: 'http://localhost:8787' })
  })

  test('a bare origin installs by catalog origin (the unique registry key)', () => {
    expect(domainRefFromTarget('crm.acme.dev')).toEqual({ origin: 'crm.acme.dev' })
    // A host:port that is not a url is still an origin, not a url.
    expect(domainRefFromTarget('dist.astrale.ai')).toEqual({ origin: 'dist.astrale.ai' })
  })
})

describe('identity-override detection', () => {
  test('origin matching the serving host is not an override', () => {
    expect(isIdentityOverride('crm.acme.dev', 'crm.acme.dev')).toBe(false)
    expect(isIdentityOverride('CRM.Acme.Dev', 'crm.acme.dev')).toBe(false)
  })

  test('origin differing from the serving host is an override', () => {
    // The spec §5 attack shape: a fork on workers.dev claiming a well-known origin.
    expect(isIdentityOverride('distribution.astrale.ai', 'crm.workers.dev')).toBe(true)
    // The scaffold default also aliases until the placeholder origin is edited.
    expect(isIdentityOverride('hldom.example.dev', 'hldom-example-dev.acme.workers.dev')).toBe(true)
  })
})

describe('declared-origin probe (/meta)', () => {
  const servers: { stop(): void }[] = []
  afterAll(() => {
    for (const s of servers) s.stop()
  })

  function serveMeta(handler: (req: Request) => Response): string {
    const server = Bun.serve({ port: 0, fetch: handler })
    servers.push(server)
    return `http://localhost:${server.port}`
  }

  test('reads domainName from a well-formed /meta', async () => {
    const url = serveMeta((req) =>
      new URL(req.url).pathname === '/meta'
        ? Response.json({ iss: 'https://x', domainName: 'crm.acme.dev' })
        : new Response('nope', { status: 404 }),
    )
    expect(await probeDeclaredOrigin(url)).toBe('crm.acme.dev')
  })

  test('degrades to undefined on missing domainName, non-200, bad JSON, or dead host', async () => {
    const noName = serveMeta(() => Response.json({ iss: 'https://x' }))
    expect(await probeDeclaredOrigin(noName)).toBeUndefined()

    const error = serveMeta(() => new Response('boom', { status: 500 }))
    expect(await probeDeclaredOrigin(error)).toBeUndefined()

    const badJson = serveMeta(() => new Response('<html>', { status: 200 }))
    expect(await probeDeclaredOrigin(badJson)).toBeUndefined()

    expect(await probeDeclaredOrigin('http://127.0.0.1:1')).toBeUndefined()
  })
})
