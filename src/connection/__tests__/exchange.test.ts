import type { Fetch } from '@astrale-os/sdk/client'

import { issuer } from '@astrale-os/sdk/auth'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ExchangeCredentialCache } from '../../state/exchange-credentials'
import { createExchangeCredentialResolver } from '../exchange'

const KERNEL = issuer.accept('https://kernel.example')
const DOMAIN = issuer.accept('https://admin.example')
const TARGET = { url: `${KERNEL}/api`, kernelIssuer: KERNEL, domainIssuer: DOMAIN }
const INVOCATION = `${KERNEL}/invoke`
const EXPIRES_AT = Math.floor(Date.now() / 1_000) + 500
const SOURCE_EXPIRES_AT = Math.floor(Date.now() / 1_000) + 600
const SOURCE_TOKEN = sourceToken('user-1')
let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-exchange-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('Domain token exchange', () => {
  /** @evidence TEST-CLI-EXCHANGE-WHOAMI-DELEGATE-EXCHANGE-CACHE */
  test('runs the exact exchange journey once and reuses it across process cache instances', async () => {
    const observed: Array<{
      url: string
      init: RequestInit | undefined
      body?: Record<string, any>
    }> = []
    const exchanged = token(DOMAIN, KERNEL, 'user-1', EXPIRES_AT)
    const fetch: Fetch = async (input, init) => {
      const url = String(input)
      if (url === INVOCATION) {
        const body = JSON.parse(await new Response(init?.body).text()) as Record<string, any>
        observed.push({ url, init, body })
        const index = observed.filter((entry) => entry.url === INVOCATION).length
        return invocationResponse(
          body.requestId,
          index === 1
            ? { id: 'user-1' }
            : index === 2
              ? 'kernel-destination-envelope'
              : { id: 'user-1' },
          new Headers(init?.headers).get('accept')!,
        )
      }
      observed.push({ url, init })
      if (url.endsWith('/.well-known/openid-configuration')) {
        return jsonResponse(configuration(true))
      }
      if (url.endsWith('/.well-known/astrale/token')) {
        expect(init?.body).toBeUndefined()
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer kernel-destination-envelope',
        )
        return jsonResponse(
          { token: exchanged, expiresAt: EXPIRES_AT },
          200,
          'application/vnd.astrale+json',
        )
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const sourceAudiences: string[] = []
    const path = join(directory, 'credentials.json')
    const resolver = createExchangeCredentialResolver(
      TARGET,
      {
        async resolve(audience) {
          sourceAudiences.push(audience)
          return SOURCE_TOKEN
        },
      },
      fetch,
      5_000,
      new ExchangeCredentialCache(path),
    )

    expect(await resolver.resolve(KERNEL, new AbortController().signal)).toBe(exchanged)
    await expect(resolver.resolve(KERNEL, new AbortController().signal)).resolves.toBe(exchanged)
    const nextProcess = createExchangeCredentialResolver(
      TARGET,
      {
        async resolve(audience) {
          sourceAudiences.push(audience)
          return SOURCE_TOKEN
        },
      },
      async () => {
        throw new Error('a warm process must not repeat exchange network I/O')
      },
      5_000,
      new ExchangeCredentialCache(path),
    )
    await expect(nextProcess.resolve(KERNEL, new AbortController().signal)).resolves.toBe(exchanged)

    const kernelRequests = observed.filter((entry) => entry.url === INVOCATION)
    expect(kernelRequests).toHaveLength(2)
    expect(kernelRequests[0]!.body).toMatchObject({
      credential: SOURCE_TOKEN,
      call: { input: {} },
    })
    expect(kernelRequests[1]!.body).toMatchObject({
      credential: SOURCE_TOKEN,
      call: {
        input: {
          audience: DOMAIN,
          attenuation: { kind: 'identity', self: true },
        },
      },
    })
    const delegatedTtl = kernelRequests[1]!.body!.call.input.ttlSeconds
    expect(delegatedTtl).toBe(240)
    expect(sourceAudiences).toEqual([KERNEL, KERNEL, KERNEL])
    expect(
      observed.filter((entry) => entry.url.endsWith('/.well-known/astrale/token')),
    ).toHaveLength(1)
  })

  test('rejects a source credential without a stable cache identity before network I/O', async () => {
    let fetches = 0
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => sourceToken(undefined) },
      async () => {
        fetches += 1
        throw new Error('network must remain untouched')
      },
      5_000,
      new ExchangeCredentialCache(join(directory, 'credentials.json')),
    )
    await expect(resolver.resolve(KERNEL, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_SOURCE_INVALID',
    })
    expect(fetches).toBe(0)
  })

  /** @evidence TEST-CLI-EXCHANGE-NO-LEGACY-FALLBACK */
  test('fails closed when issuer discovery does not advertise exchange', async () => {
    const fetch: Fetch = async (input, init) => {
      const url = String(input)
      if (url === INVOCATION) {
        const body = JSON.parse(await new Response(init?.body).text()) as Record<string, any>
        return invocationResponse(
          body.requestId,
          body.call.input && Object.keys(body.call.input).length === 0
            ? { id: 'user-1' }
            : 'kernel-destination-envelope',
          new Headers(init?.headers).get('accept')!,
        )
      }
      if (url.endsWith('/.well-known/openid-configuration'))
        return jsonResponse(configuration(false))
      throw new Error('exchange endpoint must not be called')
    }
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => SOURCE_TOKEN },
      fetch,
      5_000,
      new ExchangeCredentialCache(join(directory, 'credentials.json')),
    )
    await expect(resolver.resolve(KERNEL, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_UNSUPPORTED',
    })
  })

  test('rejects an exchanged token bound to another Kernel', async () => {
    const wrong = token(DOMAIN, issuer.accept('https://other-kernel.example'), 'user-1', EXPIRES_AT)
    const fetch = exchangeFetch(wrong)
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => SOURCE_TOKEN },
      fetch,
      5_000,
      new ExchangeCredentialCache(join(directory, 'credentials.json')),
    )
    await expect(resolver.resolve(KERNEL, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_PROTOCOL_ERROR',
    })
  })

  test('requests and retains a carrier that covers a supported long command deadline', async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 250
    const exchanged = token(DOMAIN, KERNEL, 'user-1', expiresAt)
    const observed: Record<string, any>[] = []
    const base = exchangeFetch(exchanged, { expiresAt })
    const fetch: Fetch = async (input, init) => {
      if (String(input) === INVOCATION) {
        observed.push(JSON.parse(await new Response(init?.body).text()))
      }
      return base(input, init)
    }
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => sourceToken('user-1', expiresAt + 50) },
      fetch,
      180_000,
      new ExchangeCredentialCache(join(directory, 'long-credential.json')),
    )

    await expect(resolver.resolve(KERNEL, new AbortController().signal)).resolves.toBe(exchanged)
    expect(observed[1]!.call.input.ttlSeconds).toBe(240)
  })

  /** @evidence TEST-CLI-EXCHANGE-REJECTS-INSUFFICIENT-LIFETIME */
  test('rejects a too-short Domain exchange credential before destination dispatch', async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 150
    const exchanged = token(DOMAIN, KERNEL, 'user-1', expiresAt)
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => sourceToken('user-1', expiresAt + 150) },
      exchangeFetch(exchanged, { expiresAt }),
      180_000,
      new ExchangeCredentialCache(join(directory, 'short-credential.json')),
    )

    await expect(resolver.resolve(KERNEL, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_LIFETIME_INSUFFICIENT',
    })
  })

  test('rejects a long outer Domain token whose carried Kernel proof is too short', async () => {
    const outerExpiresAt = Math.floor(Date.now() / 1_000) + 250
    const proofExpiresAt = Math.floor(Date.now() / 1_000) + 150
    const exchanged = token(DOMAIN, KERNEL, 'user-1', outerExpiresAt, proofExpiresAt)
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => sourceToken('user-1', outerExpiresAt + 50) },
      exchangeFetch(exchanged, { expiresAt: outerExpiresAt }),
      180_000,
      new ExchangeCredentialCache(join(directory, 'short-proof.json')),
    )

    await expect(resolver.resolve(KERNEL, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_LIFETIME_INSUFFICIENT',
    })
  })

  test('rejects the real 300-second Domain ceiling for a 600-second command before destination dispatch', async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 300
    const exchanged = token(DOMAIN, KERNEL, 'user-1', expiresAt)
    const observed: string[] = []
    const base = exchangeFetch(exchanged, { expiresAt })
    const fetch: Fetch = async (input, init) => {
      observed.push(String(input))
      return base(input, init)
    }
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => sourceToken('user-1', expiresAt + 700) },
      fetch,
      600_000,
      new ExchangeCredentialCache(join(directory, 'domain-ceiling.json')),
    )

    await expect(resolver.resolve(KERNEL, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_LIFETIME_INSUFFICIENT',
    })
    expect(observed.filter((url) => url === INVOCATION)).toHaveLength(2)
    expect(observed.filter((url) => url.endsWith('/.well-known/astrale/token'))).toHaveLength(1)
  })

  test('rejects success responses without no-store or with malformed fields', async () => {
    const exchanged = token(DOMAIN, KERNEL, 'user-1', EXPIRES_AT)
    const cache = () => new ExchangeCredentialCache(join(directory, crypto.randomUUID()))
    const resolver = (fetch: Fetch) =>
      createExchangeCredentialResolver(
        TARGET,
        { resolve: async () => SOURCE_TOKEN },
        fetch,
        5_000,
        cache(),
      )

    await expect(
      resolver(exchangeFetch(exchanged, { cacheControl: false })).resolve(
        KERNEL,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      message: 'Token exchange response is missing Cache-Control: no-store.',
    })
    await expect(
      resolver(exchangeFetch(exchanged, { body: { token: 7, expiresAt: 'soon' } })).resolve(
        KERNEL,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      message: 'Token exchange returned an invalid success response.',
    })
  })

  test('normalizes native issuer Fetch failures without exposing their message', async () => {
    const native = new AggregateError([new Error('private DNS state')], '')
    const resolver = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => SOURCE_TOKEN },
      async (input, init) => {
        if (String(input) === INVOCATION) {
          const body = JSON.parse(await new Response(init?.body).text()) as Record<string, any>
          return invocationResponse(
            body.requestId,
            body.call.input && Object.keys(body.call.input).length === 0
              ? { id: 'user-1' }
              : 'kernel-destination-envelope',
            new Headers(init?.headers).get('accept')!,
          )
        }
        throw native
      },
      5_000,
      new ExchangeCredentialCache(join(directory, 'native-failure.json')),
    )

    await expect(resolver.resolve(KERNEL, new AbortController().signal)).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_UNAVAILABLE',
      message: 'Domain issuer discovery could not be reached.',
      cause: native,
    })
  })
})

function exchangeFetch(
  exchanged: string,
  options: {
    readonly body?: unknown
    readonly cacheControl?: boolean
    readonly expiresAt?: number
  } = {},
): Fetch {
  return async (input, init) => {
    const url = String(input)
    if (url === INVOCATION) {
      const body = JSON.parse(await new Response(init?.body).text()) as Record<string, any>
      return invocationResponse(
        body.requestId,
        body.call.input && Object.keys(body.call.input).length === 0
          ? { id: 'user-1' }
          : 'kernel-destination-envelope',
        new Headers(init?.headers).get('accept')!,
      )
    }
    if (url.endsWith('/.well-known/openid-configuration')) return jsonResponse(configuration(true))
    const response = new Response(
      JSON.stringify(
        options.body ?? { token: exchanged, expiresAt: options.expiresAt ?? EXPIRES_AT },
      ),
      {
        status: 200,
        headers: {
          'content-type': 'application/vnd.astrale+json',
          ...(options.cacheControl === false ? {} : { 'cache-control': 'no-store' }),
        },
      },
    )
    return response
  }
}

function configuration(enabled: boolean) {
  return {
    issuer: DOMAIN,
    jwks_uri: `${DOMAIN}/.well-known/jwks.json`,
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['EdDSA'],
    ...(enabled ? { token_exchange_endpoint: `${DOMAIN}/.well-known/astrale/token` } : {}),
  }
}

function invocationResponse(requestId: unknown, result: unknown, contentType: string): Response {
  const invocation = { source: KERNEL, id: `exchange-${String(requestId)}` }
  return new Response(JSON.stringify({ requestId, invocation, result }), {
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  })
}

function jsonResponse(value: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  })
}

function token(iss: string, aud: string, user: string, exp: number, proofExp = exp): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const proof = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: aud,
    sub: user,
    aud,
    exp: proofExp,
    delegation: { v: 1, expr: { kind: 'identity', id: user } },
  })}.signature`
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss,
    sub: 'admin-domain',
    aud,
    exp,
    grant: { v: 1, expr: { kind: 'identity', credential: proof } },
  })}.signature`
}

function sourceToken(subject: string | undefined, expiresAt = SOURCE_EXPIRES_AT): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: 'https://workos.example',
    ...(subject === undefined ? {} : { sub: subject }),
    aud: KERNEL,
    exp: expiresAt,
  })}.signature`
}
