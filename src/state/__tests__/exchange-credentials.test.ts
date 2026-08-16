import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
  test('partitions by Kernel, Domain, and User under private filesystem modes', async () => {
    const cache = new ExchangeCredentialCache(path)
    const now = () => 100
    const first = key('https://kernel-a.example', 'https://domain.example', 'user-a')
    const second = key('https://kernel-a.example', 'https://domain.example', 'user-b')
    let refreshes = 0

    const resolve = (candidate: typeof first) =>
      cache.getOrRefresh(
        candidate,
        async () => {
          refreshes += 1
          return {
            credential: token(candidate.domainIssuer, candidate.kernelIssuer, 200),
            expiresAt: 200,
          }
        },
        now,
      )

    await expect(resolve(first)).resolves.toBe(token(first.domainIssuer, first.kernelIssuer, 200))
    await expect(resolve(first)).resolves.toBe(token(first.domainIssuer, first.kernelIssuer, 200))
    await expect(resolve(second)).resolves.toBe(
      token(second.domainIssuer, second.kernelIssuer, 200),
    )
    expect(refreshes).toBe(2)
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
      return {
        credential: token(candidate.domainIssuer, candidate.kernelIssuer, 200),
        expiresAt: 200,
      }
    }

    const values = await Promise.all([
      left.getOrRefresh(candidate, refresh, () => 100),
      left.getOrRefresh(candidate, refresh, () => 100),
      right.getOrRefresh(candidate, refresh, () => 100),
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
      async () => ({
        credential: token(candidate.domainIssuer, candidate.kernelIssuer, 120),
        expiresAt: 120,
      }),
      () => 50,
    )
    let refreshes = 0
    await cache.getOrRefresh(
      candidate,
      async () => {
        refreshes += 1
        return {
          credential: token(candidate.domainIssuer, candidate.kernelIssuer, 220),
          expiresAt: 220,
        }
      },
      () => 100,
    )
    expect(refreshes).toBe(1)

    await expect(
      cache.getOrRefresh(
        key('https://other-kernel.example', candidate.domainIssuer, candidate.user),
        async () => ({
          credential: token(candidate.domainIssuer, candidate.kernelIssuer, 220),
          expiresAt: 220,
        }),
        () => 100,
      ),
    ).rejects.toThrow(/inconsistent with its cache key/i)
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-LIFECYCLE-INVALIDATION */
  test('invalidates one Kernel or the entire cache', async () => {
    const cache = new ExchangeCredentialCache(path)
    const a = key('https://kernel-a.example', 'https://domain.example', 'user')
    const b = key('https://kernel-b.example', 'https://domain.example', 'user')
    for (const candidate of [a, b]) {
      await cache.getOrRefresh(
        candidate,
        async () => ({
          credential: token(candidate.domainIssuer, candidate.kernelIssuer, 200),
          expiresAt: 200,
        }),
        () => 100,
      )
    }
    await cache.deleteKernel(a.kernelIssuer)
    expect(await readFile(path, 'utf8')).not.toContain(a.kernelIssuer)
    expect(await readFile(path, 'utf8')).toContain(b.kernelIssuer)
    await cache.clear()
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual({})
  })
})

function key(kernelIssuer: string, domainIssuer: string, user: string) {
  return { kernelIssuer, domainIssuer, user }
}

function token(iss: string, aud: string, exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({ iss, sub: 'domain', aud, exp })}.signature`
}
