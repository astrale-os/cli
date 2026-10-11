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

/** One request the fake network answered: an invocation's parsed body, or a Domain request. */
interface Seen {
  readonly url: string
  readonly body?: any
  readonly authorization?: string | null
}

/** A resolver of the source caller `user` over `fetch` and the cache file `file`. */
function resolver(
  fetch: Fetch,
  options: {
    user?: string
    file?: string
    timeoutMs?: number
    sourceExpiresAt?: number
    audiences?: string[]
  } = {},
) {
  const user = options.user ?? 'user-1'
  return createExchangeCredentialResolver(
    TARGET,
    {
      cacheIdentity: async () => ({ issuer: 'https://workos.example', subject: user }),
      async resolve(audience) {
        options.audiences?.push(audience)
        return sourceToken(user, options.sourceExpiresAt)
      },
    },
    fetch,
    options.timeoutMs ?? 5_000,
    new ExchangeCredentialCache(join(directory, options.file ?? `${crypto.randomUUID()}.json`)),
  )
}

/** One fresh resolution of user-1 at the Domain through `fetch`, with an empty cache. */
function resolve(fetch: Fetch): Promise<string> {
  return resolver(fetch).resolve(KERNEL, live())
}

describe('Domain token exchange', () => {
  /** @evidence TEST-CLI-EXCHANGE-WHOAMI-DELEGATE-EXCHANGE-CACHE */
  test('runs the exact exchange journey once and reuses it across process cache instances', async () => {
    const seen: Seen[] = []
    const audiences: string[] = []
    const exchanged = token(DOMAIN, KERNEL, 'user-1', EXPIRES_AT)
    const first = resolver(exchangeFetch(exchanged, { seen }), {
      file: 'credentials.json',
      audiences,
    })
    expect(await first.resolve(KERNEL, live())).toBe(exchanged)
    await expect(first.resolve(KERNEL, live())).resolves.toBe(exchanged)

    let identityReads = 0
    const nextProcess = createExchangeCredentialResolver(
      TARGET,
      {
        async cacheIdentity() {
          identityReads += 1
          return { issuer: 'https://workos.example', subject: 'user-1' }
        },
        async resolve() {
          throw new Error('a warm process must not resolve source authority')
        },
      },
      async () => {
        throw new Error('a warm process must not repeat exchange network I/O')
      },
      5_000,
      new ExchangeCredentialCache(join(directory, 'credentials.json')),
    )
    await expect(nextProcess.resolve(KERNEL, live())).resolves.toBe(exchanged)
    expect(identityReads).toBe(1)
    expect(audiences).toEqual([KERNEL])

    const [whoami, delegate, ...rest] = seen.filter((entry) => entry.url === INVOCATION)
    expect(rest).toEqual([])
    expect(whoami!.body).toMatchObject({ credential: SOURCE_TOKEN, call: { input: {} } })
    expect(delegate!.body.credential).toBe(SOURCE_TOKEN)
    expect(delegate!.body.call.input).toEqual({
      audience: DOMAIN,
      principal: 'user-1',
      ttlSeconds: 240,
    })
    expect(seen.filter((entry) => entry.url.endsWith('/.well-known/astrale/token'))).toEqual([
      {
        url: `${DOMAIN}/.well-known/astrale/token`,
        body: undefined,
        authorization: 'Bearer kernel-destination-envelope',
      },
    ])
  })

  /** @evidence TEST-CLI-EXCHANGE-REJECTS-DOMAIN-SELF-AUTHORITY */
  test.each([
    ['Domain self authority beside the caller proof', 'union', KERNEL],
    ['a token bound to another Kernel', 'caller', issuer.accept('https://other.example')],
  ] as const)('rejects %s', async (_case, mode, audience) => {
    const exchanged = token(DOMAIN, audience, 'user-1', EXPIRES_AT, EXPIRES_AT, mode)
    await expect(resolve(exchangeFetch(exchanged))).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_PROTOCOL_ERROR',
    })
  })

  test('does not reuse an exchange credential after the persisted source identity changes', async () => {
    const file = 'credentials.json'
    await resolver(exchangeFetch(token(DOMAIN, KERNEL, 'user-1', EXPIRES_AT)), { file }).resolve(
      KERNEL,
      live(),
    )
    const second = token(DOMAIN, KERNEL, 'user-2', EXPIRES_AT)
    const changed = resolver(exchangeFetch(second, { user: 'user-2' }), { user: 'user-2', file })
    await expect(changed.resolve(KERNEL, live())).resolves.toBe(second)
  })

  test('rejects a source credential without a stable cache identity before network I/O', async () => {
    const seen: Seen[] = []
    const anonymous = createExchangeCredentialResolver(
      TARGET,
      { resolve: async () => sourceToken(undefined) },
      exchangeFetch('unused', { seen }),
      5_000,
      new ExchangeCredentialCache(join(directory, 'credentials.json')),
    )
    await expect(anonymous.resolve(KERNEL, live())).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_SOURCE_INVALID',
    })
    expect(seen).toEqual([])
  })

  /** @evidence TEST-CLI-EXCHANGE-NO-LEGACY-FALLBACK */
  test('fails closed when issuer discovery does not advertise exchange', async () => {
    const seen: Seen[] = []
    await expect(
      resolve(exchangeFetch('unused', { advertise: false, seen })),
    ).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_UNSUPPORTED',
      message: `Domain issuer ${DOMAIN} does not advertise token exchange.`,
    })
    expect(seen.some((entry) => entry.url.endsWith('/token'))).toBe(false)
  })

  test('keeps the Domain refusal, maps an invalid answer, and hides a native Fetch failure', async () => {
    const refused = { status: 401, body: { error: { code: 2002, message: 'Token is invalid.' } } }
    await expect(resolve(exchangeFetch('unused', refused))).rejects.toMatchObject({
      code: '2002',
      message: 'Token is invalid.',
      cause: { failure: 'rejected' },
    })
    const invalid = { body: { token: 7, expiresAt: 'soon' } }
    await expect(resolve(exchangeFetch('unused', invalid))).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      message: 'Domain token exchange returned an invalid response.',
    })
    const native = new AggregateError([new Error('private DNS state')], '')
    await expect(resolve(exchangeFetch('unused', { unreachable: native }))).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_UNAVAILABLE',
      message: 'Domain discovery could not be reached.',
      cause: { failure: 'unavailable', cause: native },
    })
  })

  /** @evidence TEST-CLI-EXCHANGE-REJECTS-INSUFFICIENT-LIFETIME */
  test.each([
    ['an outer token and proof that cover it', 250, 250, undefined],
    ['an outer token that cannot', 150, 150, 'TOKEN_EXCHANGE_LIFETIME_INSUFFICIENT'],
    ['a carried Kernel proof that cannot', 250, 150, 'TOKEN_EXCHANGE_LIFETIME_INSUFFICIENT'],
  ])('a 180 s command deadline with %s', async (_, outer, proof, refusal) => {
    const now = Math.floor(Date.now() / 1_000)
    const exchanged = token(DOMAIN, KERNEL, 'user-1', now + outer, now + proof)
    const seen: Seen[] = []
    const resolution = resolver(exchangeFetch(exchanged, { expiresAt: now + outer, seen }), {
      timeoutMs: 180_000,
      sourceExpiresAt: now + 600,
    }).resolve(KERNEL, live())
    if (refusal === undefined) await expect(resolution).resolves.toBe(exchanged)
    else await expect(resolution).rejects.toMatchObject({ code: refusal })
    // whoami, then the delegation for a carrier covering the deadline: never a destination dispatch.
    const invocations = seen.filter((entry) => entry.url === INVOCATION)
    expect(invocations).toHaveLength(2)
    expect(invocations[1]!.body.call.input.ttlSeconds).toBe(240)
  })
})

/** A Kernel and Domain issuer that answer user's exchange with `exchanged`, recording to `seen`. */
function exchangeFetch(
  exchanged: string,
  options: {
    readonly body?: unknown
    readonly expiresAt?: number
    readonly status?: number
    readonly user?: string
    readonly advertise?: boolean
    readonly unreachable?: unknown
    readonly seen?: Seen[]
  } = {},
): Fetch {
  return exact(async (input, init) => {
    const url = String(input)
    if (url === INVOCATION) {
      const body = JSON.parse(await new Response(init?.body).text()) as Record<string, any>
      options.seen?.push({ url, body })
      return invocationResponse(
        body.requestId,
        body.call.input && Object.keys(body.call.input).length === 0
          ? { id: options.user ?? 'user-1' }
          : 'kernel-destination-envelope',
        new Headers(init?.headers).get('accept')!,
      )
    }
    if (options.unreachable !== undefined) throw options.unreachable
    const authorization = new Headers(init?.headers).get('authorization')
    options.seen?.push({ url, body: init?.body, authorization })
    if (url.endsWith('/.well-known/openid-configuration')) {
      return jsonResponse(configuration(options.advertise ?? true))
    }
    if (!url.endsWith('/.well-known/astrale/token')) throw new Error(`unexpected URL ${url}`)
    return jsonResponse(
      options.body ?? { token: exchanged, expiresAt: options.expiresAt ?? EXPIRES_AT },
      options.status ?? 200,
      'application/vnd.astrale+json',
    )
  })
}

function live(): AbortSignal {
  return new AbortController().signal
}

/** Report the answered URL on each response, as a network fetch does. */
function exact(fetch: Fetch): Fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    if (response.url === '') Object.defineProperty(response, 'url', { value: String(input) })
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

function token(
  iss: string,
  aud: string,
  user: string,
  exp: number,
  proofExp = exp,
  mode: 'caller' | 'union' = 'caller',
): string {
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
    grant: {
      v: 1,
      expr:
        mode === 'caller'
          ? { kind: 'identity', credential: proof }
          : {
              kind: 'union',
              operands: [
                { kind: 'identity', self: true },
                { kind: 'identity', credential: proof },
              ],
            },
    },
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
