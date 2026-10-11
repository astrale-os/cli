import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ExchangeCredentialCache } from '../exchange-credentials'
import { withFileLock } from '../files'

let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-exchange-cache-'))
  path = join(directory, 'private', 'credentials.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** Every cache call of these tests happens at t = 100 s. */
const now = () => 100
const USER = key('https://kernel.example', 'https://domain.example', 'user')

/** Resolve `candidate` for an invocation needing `needs` seconds, refreshing to `expiresAt`. */
function fill(cache: ExchangeCredentialCache, candidate = USER, expiresAt = 200, needs = 30) {
  return cache.getOrRefresh(candidate, needs, async () => entry(candidate, expiresAt), now)
}

describe('exchange credential cache', () => {
  /** @evidence TEST-CLI-EXCHANGE-CACHE-EXACT-KEY-AND-PRIVATE-MODE */
  test('partitions by Kernel, Domain, and source identity under private filesystem modes', async () => {
    const cache = new ExchangeCredentialCache(path)
    const first = key('https://kernel-a.example', 'https://domain.example', 'user-a')
    const { kernelIssuer, domainIssuer, sourceSubject } = first
    const partitions = [
      first,
      key('https://kernel-b.example', domainIssuer, sourceSubject),
      key(kernelIssuer, 'https://other-domain.example', sourceSubject),
      key(kernelIssuer, domainIssuer, sourceSubject, 'https://other-source.example'),
      key(kernelIssuer, domainIssuer, 'user-b'),
    ]
    let refreshes = 0
    const resolve = (candidate: Key) =>
      cache.getOrRefresh(candidate, 30, async () => (refreshes++, entry(candidate, 200)), now)

    for (const candidate of partitions) {
      await expect(resolve(candidate)).resolves.toBe(token(candidate, 200))
      await expect(resolve(candidate)).resolves.toBe(token(candidate, 200))
    }
    expect(refreshes).toBe(partitions.length)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(directory, 'private'))).mode & 0o777).toBe(0o700)
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-EXACT-LIVE-LOOKUP */
  /** @evidence TEST-CLI-EXCHANGE-CACHE-READ-DOES-NOT-WAIT-FOR-REFRESH */
  test('reads only an exact live binding, never waiting behind a refresh lock', async () => {
    const cache = new ExchangeCredentialCache(path)
    await fill(cache)

    const locked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const holder = withFileLock(`${path}.lock`, async () => {
      locked.resolve()
      await release.promise
    })
    await locked.promise
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('exact cache read waited for refresh lock')), 100)
      })
      await expect(Promise.race([cache.get(USER, 30, now), timeout])).resolves.toBe(
        token(USER, 200),
      )
    } finally {
      clearTimeout(timer)
      release.resolve()
      await holder
    }

    await expect(
      cache.get({ ...USER, sourceSubject: 'other-user' }, 30, now),
    ).resolves.toBeUndefined()
    await expect(cache.get(USER, 101, now)).resolves.toBeUndefined()
    const stored = JSON.parse(await readFile(path, 'utf8'))
    const [encoded] = Object.keys(stored.entries)
    stored.entries[encoded].user = 'substituted-user'
    await writeFile(path, JSON.stringify(stored))
    await expect(cache.get(USER, 30, now)).resolves.toBeUndefined()
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-SINGLEFLIGHT-CROSS-INSTANCE */
  test('singleflights refreshes in-process and through the cross-process file lock', async () => {
    const left = new ExchangeCredentialCache(path)
    const right = new ExchangeCredentialCache(path)
    let refreshes = 0
    const refresh = async () => {
      refreshes += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return entry(USER, 200)
    }
    const values = await Promise.all(
      [left, left, right].map((cache) => cache.getOrRefresh(USER, 30, refresh, now)),
    )
    expect(new Set(values).size).toBe(1)
    expect(refreshes).toBe(1)
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-REJECTS-STALE-OR-MISBOUND */
  /** @evidence TEST-CLI-EXCHANGE-CACHE-REJECTS-DOMAIN-SELF-AUTHORITY */
  test.each([
    ['another Kernel', { kernelIssuer: 'https://other-kernel.example' }, {}],
    ['another source subject', { sourceSubject: 'other-source' }, {}],
    ['an outer delegation', {}, { malformed: 'outer-delegation' }],
    ['a proof without delegation', {}, { malformed: 'proof-without-delegation' }],
    ['Domain self authority', {}, { mode: 'union' }],
    ['a carried proof shorter than the invocation', {}, { proofExpiresAt: 120 }],
  ] as const)('never retains a fresh credential bound to %s', async (_case, keyed, shape) => {
    const cache = new ExchangeCredentialCache(path)
    const asked = { ...USER, ...keyed }
    const fresh = entry(USER, 300, shape as Shape)
    await expect(cache.getOrRefresh(asked, 30, async () => fresh, now)).rejects.toThrow(
      /inconsistent with its cache key or required lifetime/i,
    )
    await expect(cache.get(asked, 30, now)).resolves.toBeUndefined()
  })

  /** @evidence TEST-CLI-EXCHANGE-CACHE-LIFECYCLE-INVALIDATION */
  test('invalidates one Kernel or the entire cache', async () => {
    const cache = new ExchangeCredentialCache(path)
    const a = key('https://kernel-a.example', 'https://domain.example', 'user')
    const b = key('https://kernel-b.example', 'https://domain.example', 'user')
    await fill(cache, a)
    await fill(cache, b)
    await cache.deleteKernel(a.kernelIssuer)
    expect(await readFile(path, 'utf8')).not.toContain(a.kernelIssuer)
    expect(await readFile(path, 'utf8')).toContain(b.kernelIssuer)
    await cache.clear()
    expect(JSON.parse(await readFile(path, 'utf8')).entries).toEqual({})
  })

  test('refreshes a valid cached credential that cannot cover the requested invocation', async () => {
    const cache = new ExchangeCredentialCache(path)
    await fill(cache, USER, 250)
    await expect(fill(cache, USER, 300, 185)).resolves.toBe(token(USER, 300))
    await expect(fill(cache, USER, 190, 201)).rejects.toThrow(/required lifetime/i)
  })

  test('a long caller behind a concurrent short refresh never receives the short carrier', async () => {
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    let refreshes = 0
    const short = new ExchangeCredentialCache(path).getOrRefresh(
      USER,
      30,
      async () => {
        refreshes += 1
        started.resolve()
        await release.promise
        return entry(USER, 200)
      },
      now,
    )
    await started.promise
    const long = new ExchangeCredentialCache(path).getOrRefresh(
      USER,
      185,
      async () => (refreshes++, entry(USER, 300)),
      now,
    )
    release.resolve()
    expect(await Promise.all([short, long])).toEqual([token(USER, 200), token(USER, 300)])
    expect(refreshes).toBe(2)
  })
})

/** How a fresh credential departs from the one its key admits. */
interface Shape {
  readonly malformed?: 'outer-delegation' | 'proof-without-delegation'
  readonly proofExpiresAt?: number
  readonly mode?: 'caller' | 'union'
}

type Key = ReturnType<typeof key>

function key(
  kernelIssuer: string,
  domainIssuer: string,
  sourceSubject: string,
  sourceIssuer = 'https://source.example',
) {
  return { kernelIssuer, domainIssuer, sourceIssuer, sourceSubject }
}

function entry(candidate: Key, expiresAt: number, shape: Shape = {}) {
  return {
    credential: token(candidate, expiresAt, shape),
    expiresAt,
    user: candidate.sourceSubject,
    sourceIssuer: candidate.sourceIssuer,
    sourceSubject: candidate.sourceSubject,
  }
}

function token(candidate: Key, exp: number, shape: Shape = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'EdDSA', typ: 'JWT' })
  const delegation = { v: 1, expr: { kind: 'identity', id: candidate.sourceSubject } }
  const proof = `${header}.${encode({
    iss: candidate.kernelIssuer,
    sub: candidate.sourceSubject,
    aud: candidate.kernelIssuer,
    exp: shape.proofExpiresAt ?? exp,
    ...(shape.malformed === 'proof-without-delegation' ? {} : { delegation }),
  })}.signature`
  const caller = { kind: 'identity', credential: proof }
  const expr =
    shape.mode === 'union'
      ? { kind: 'union', operands: [{ kind: 'identity', self: true }, caller] }
      : caller
  return `${header}.${encode({
    iss: candidate.domainIssuer,
    sub: 'domain',
    aud: candidate.kernelIssuer,
    exp,
    grant: { v: 1, expr },
    ...(shape.malformed === 'outer-delegation' ? { delegation: { credential: proof } } : {}),
  })}.signature`
}
