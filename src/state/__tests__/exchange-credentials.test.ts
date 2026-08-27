import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ExchangeCredentialCache } from '../exchange-credentials'

let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-exchange-cache-'))
  path = join(directory, 'private', 'credentials.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('exchange credential cache', () => {
  /** @evidence TEST-CLI-EXCHANGE-CACHE-EXACT-KEY-AND-PRIVATE-MODE */
  test('partitions by Kernel, Domain, and source identity under private filesystem modes', async () => {
    const cache = new ExchangeCredentialCache(path)
    const now = () => 100
    const first = key('https://kernel-a.example', 'https://domain.example', 'user-a')
    const partitions = [
      first,
      key('https://kernel-b.example', first.domainIssuer, first.sourceSubject),
      key(first.kernelIssuer, 'https://other-domain.example', first.sourceSubject),
      key(
        first.kernelIssuer,
        first.domainIssuer,
        first.sourceSubject,
        'https://other-source.example',
      ),
      key(first.kernelIssuer, first.domainIssuer, 'user-b'),
    ]
    let refreshes = 0

    const resolve = (candidate: typeof first) =>
      cache.getOrRefresh(
        candidate,
        30,
        async () => {
          refreshes += 1
          return entry(candidate, 200)
        },
        now,
      )

    for (const candidate of partitions) {
      await expect(resolve(candidate)).resolves.toBe(token(candidate, 200))
      await expect(resolve(candidate)).resolves.toBe(token(candidate, 200))
    }
    expect(refreshes).toBe(partitions.length)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(directory, 'private'))).mode & 0o777).toBe(0o700)
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-SINGLEFLIGHT-CROSS-INSTANCE */
  test('singleflights refreshes in-process and through the cross-process file lock', async () => {
    const left = new ExchangeCredentialCache(path)
    const right = new ExchangeCredentialCache(path)
    const candidate = key('https://kernel.example', 'https://domain.example', 'user')
    let refreshes = 0
    const refresh = async () => {
      refreshes += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return entry(candidate, 200)
    }

    const values = await Promise.all([
      left.getOrRefresh(candidate, 30, refresh, () => 100),
      left.getOrRefresh(candidate, 30, refresh, () => 100),
      right.getOrRefresh(candidate, 30, refresh, () => 100),
    ])
    expect(new Set(values).size).toBe(1)
    expect(refreshes).toBe(1)
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-REJECTS-STALE-OR-MISBOUND */
  test('removes stale entries and rejects a freshly returned misbound token', async () => {
    const cache = new ExchangeCredentialCache(path)
    const candidate = key('https://kernel.example', 'https://domain.example', 'user')
    await cache.getOrRefresh(
      candidate,
      30,
      async () => entry(candidate, 120),
      () => 50,
    )
    let refreshes = 0
    await cache.getOrRefresh(
      candidate,
      30,
      async () => {
        refreshes += 1
        return entry(candidate, 220)
      },
      () => 100,
    )
    expect(refreshes).toBe(1)

    await expect(
      cache.getOrRefresh(
        key('https://other-kernel.example', candidate.domainIssuer, candidate.sourceSubject),
        30,
        async () => entry(candidate, 220),
        () => 100,
      ),
    ).rejects.toThrow(/inconsistent with its cache key/i)

    await expect(
      cache.getOrRefresh(
        key(candidate.kernelIssuer, candidate.domainIssuer, 'other-source'),
        30,
        async () => entry(candidate, 220),
        () => 100,
      ),
    ).rejects.toThrow(/inconsistent with its cache key/i)

    for (const malformed of ['outer-delegation', 'proof-without-delegation'] as const) {
      const malformedCandidate = key(
        candidate.kernelIssuer,
        candidate.domainIssuer,
        `user-${malformed}`,
      )
      await expect(
        cache.getOrRefresh(
          malformedCandidate,
          30,
          async () => entry(malformedCandidate, 220, malformed),
          () => 100,
        ),
      ).rejects.toThrow(/inconsistent with its cache key/i)
    }
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-LIFECYCLE-INVALIDATION */
  test('invalidates one Kernel or the entire cache', async () => {
    const cache = new ExchangeCredentialCache(path)
    const a = key('https://kernel-a.example', 'https://domain.example', 'user')
    const b = key('https://kernel-b.example', 'https://domain.example', 'user')
    for (const candidate of [a, b]) {
      await cache.getOrRefresh(
        candidate,
        30,
        async () => entry(candidate, 200),
        () => 100,
      )
    }
    await cache.deleteKernel(a.kernelIssuer)
    expect(await readFile(path, 'utf8')).not.toContain(a.kernelIssuer)
    expect(await readFile(path, 'utf8')).toContain(b.kernelIssuer)
    await cache.clear()
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual({})
  })

  test('discards the V1 cache and writes only V2 after a fresh exact exchange', async () => {
    await mkdir(join(directory, 'private'))
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        entries: { legacy: { credential: 'legacy', expiresAt: 999 } },
      }),
    )
    const cache = new ExchangeCredentialCache(path)
    const candidate = key('https://kernel.example', 'https://domain.example', 'source-user')
    let refreshes = 0
    await cache.getOrRefresh(
      candidate,
      30,
      async () => {
        refreshes += 1
        return entry(candidate, 200)
      },
      () => 100,
    )
    expect(refreshes).toBe(1)
    const stored = JSON.parse(await readFile(path, 'utf8'))
    expect(stored.version).toBe(2)
    expect(JSON.stringify(stored)).not.toContain('legacy')
  })

  test('refreshes a valid cached credential that cannot cover the requested invocation', async () => {
    const cache = new ExchangeCredentialCache(path)
    const candidate = key('https://kernel.example', 'https://domain.example', 'user')
    await cache.getOrRefresh(
      candidate,
      30,
      async () => entry(candidate, 250),
      () => 100,
    )
    let refreshes = 0

    await expect(
      cache.getOrRefresh(
        candidate,
        185,
        async () => {
          refreshes += 1
          return entry(candidate, 300)
        },
        () => 100,
      ),
    ).resolves.toBe(token(candidate, 300))
    expect(refreshes).toBe(1)

    await expect(
      cache.getOrRefresh(
        candidate,
        201,
        async () => entry(candidate, 190),
        () => 100,
      ),
    ).rejects.toThrow(/required lifetime/i)
  })

  test('rejects a long outer token whose carried proof cannot cover the requested invocation', async () => {
    const cache = new ExchangeCredentialCache(path)
    const candidate = key('https://kernel.example', 'https://domain.example', 'user')

    await expect(
      cache.getOrRefresh(
        candidate,
        185,
        async () => entry(candidate, 300, undefined, 150),
        () => 100,
      ),
    ).rejects.toThrow(/required lifetime/i)
  })

  test('serializes concurrent short and long callers without serving a short carrier to the long caller', async () => {
    for (const firstKind of ['short', 'long'] as const) {
      const concurrentPath = join(directory, firstKind, 'credentials.json')
      const firstCache = new ExchangeCredentialCache(concurrentPath)
      const secondCache = new ExchangeCredentialCache(concurrentPath)
      const candidate = key('https://kernel.example', 'https://domain.example', firstKind)
      let releaseFirst!: () => void
      let markFirstStarted!: () => void
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve
      })
      const release = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      let refreshes = 0
      const firstMinimum = firstKind === 'short' ? 30 : 185
      const firstExpiration = firstKind === 'short' ? 200 : 300
      const first = firstCache.getOrRefresh(
        candidate,
        firstMinimum,
        async () => {
          refreshes += 1
          markFirstStarted()
          await release
          return entry(candidate, firstExpiration)
        },
        () => 100,
      )
      await firstStarted
      const secondMinimum = firstKind === 'short' ? 185 : 30
      const secondExpiration = firstKind === 'short' ? 300 : 200
      const second = secondCache.getOrRefresh(
        candidate,
        secondMinimum,
        async () => {
          refreshes += 1
          return entry(candidate, secondExpiration)
        },
        () => 100,
      )
      releaseFirst()

      const [firstValue, secondValue] = await Promise.all([first, second])
      const longValue = firstKind === 'long' ? firstValue : secondValue
      expect(longValue).toBe(token(candidate, 300))
      expect(refreshes).toBe(firstKind === 'short' ? 2 : 1)
    }
  })
})

function key(
  kernelIssuer: string,
  domainIssuer: string,
  sourceSubject: string,
  sourceIssuer = 'https://source.example',
) {
  return {
    kernelIssuer,
    domainIssuer,
    sourceIssuer,
    sourceSubject,
  }
}

function entry(
  candidate: ReturnType<typeof key>,
  expiresAt: number,
  malformed?: 'outer-delegation' | 'proof-without-delegation',
  proofExpiresAt = expiresAt,
) {
  return {
    credential: token(candidate, expiresAt, malformed, proofExpiresAt),
    expiresAt,
    user: candidate.sourceSubject,
    sourceIssuer: candidate.sourceIssuer,
    sourceSubject: candidate.sourceSubject,
  }
}

function token(
  candidate: ReturnType<typeof key>,
  exp: number,
  malformed?: 'outer-delegation' | 'proof-without-delegation',
  proofExp = exp,
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const proof = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: candidate.kernelIssuer,
    sub: candidate.sourceSubject,
    aud: candidate.kernelIssuer,
    exp: proofExp,
    ...(malformed === 'proof-without-delegation'
      ? {}
      : {
          delegation: {
            v: 1,
            expr: { kind: 'identity', id: candidate.sourceSubject },
          },
        }),
  })}.signature`
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: candidate.domainIssuer,
    sub: 'domain',
    aud: candidate.kernelIssuer,
    exp,
    grant: { v: 1, expr: { kind: 'identity', credential: proof } },
    ...(malformed === 'outer-delegation' ? { delegation: { credential: proof } } : {}),
  })}.signature`
}
