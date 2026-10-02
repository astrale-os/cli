import type { Fetch } from '@astrale-os/sdk/client'
import type { DomainInfo } from '@astrale-os/sdk/client/schema'

import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError } from '@astrale-os/sdk/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstalledDomainReader } from '../installed-issuer'

import { ExchangeCredentialCache } from '../../state/exchange-credentials'
import { InstallationCache } from '../../state/installations'
import { createExchangeCredentialResolver } from '../exchange'
import { createInstalledIssuer } from '../installed-issuer'

const KERNEL = issuer.accept('https://kernel.example')
const INVOCATION = `${KERNEL}/invoke`
const SHELL = 'shell.astrale.ai'
/** The stable issuer every managed Instance installs the Shell with today. */
const LEGACY_SHELL = issuer.accept('https://shell.beta.astrale.ai')
/** Immutable deployments: each one is its own issuer, and none is derivable from the route. */
const DEPLOYMENT = issuer.accept('https://shell-beta-0123456789abcdef.deployments.example')
const NEXT_DEPLOYMENT = issuer.accept('https://shell-beta-fedcba9876543210.deployments.example')
const TARGET = { url: `${KERNEL}/api`, kernelIssuer: KERNEL, domainOrigin: SHELL }
const EXPIRES_AT = Math.floor(Date.now() / 1_000) + 500
const SOURCE_EXPIRES_AT = Math.floor(Date.now() / 1_000) + 600
const INVOCATION_ID = { source: KERNEL, id: 'inspect' } as ConstructorParameters<
  typeof ResponseError
>[2]

type IssuerState = 'live' | 'retired' | 'refuses'

let directory: string
let credentials: ExchangeCredentialCache
let installations: InstallationCache

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-installed-issuer-'))
  credentials = new ExchangeCredentialCache(join(directory, 'exchange', 'credentials.json'))
  installations = new InstallationCache(join(directory, 'session', 'installations.json'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('Shell exchange at the installed issuer', () => {
  /** @evidence TEST-CLI-INSTALLED-SHELL-DEPLOYMENT-ISSUER */
  test('exchanges at the deployment issuer the Kernel pin names, read as the source caller', async () => {
    const net = network({ [DEPLOYMENT]: 'live', [LEGACY_SHELL]: 'live' })
    const pin = pinned(DEPLOYMENT)
    const resolver = shellResolver(net.fetch, pin.read)

    await expect(resolver.resolve(KERNEL, live())).resolves.toBe(exchanged(DEPLOYMENT))
    await expect(resolver.resolve(KERNEL, live())).resolves.toBe(exchanged(DEPLOYMENT))

    expect(pin.reads).toEqual([SHELL])
    // The pin is read through the Session that authenticates the source caller, before any Domain.
    expect(net.requests[0]).toBe(`kernel ${INVOCATION} as source`)
    expect(net.requests.filter((request) => request.includes(LEGACY_SHELL))).toEqual([])
    expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([
      `domain ${DEPLOYMENT}/.well-known/openid-configuration`,
      `domain ${DEPLOYMENT}/.well-known/astrale/token`,
    ])
    expect(await installations.get(KERNEL, SHELL)).toEqual({ issuer: DEPLOYMENT })

    // The next command selects its persisted credential with the remembered issuer, offline.
    const offline = network({})
    const nextProcess = createExchangeCredentialResolver(
      TARGET,
      {
        cacheIdentity: async () => ({ issuer: 'https://workos.example', subject: 'user-1' }),
        async resolve() {
          throw new Error('a warm command must not resolve source authority')
        },
      },
      offline.fetch,
      5_000,
      credentials,
      createInstalledIssuer(KERNEL, SHELL, installations, pinned().read),
    )
    await expect(nextProcess.resolve(KERNEL, live())).resolves.toBe(exchanged(DEPLOYMENT))
    expect(offline.requests).toEqual([])
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-STALE-ISSUER-RECOVERS-ONCE */
  test.each(['retired', 'refuses'] as const)(
    'reads the pin again once and retries when the issuer this session read is %s',
    async (stale) => {
      const state: Record<string, IssuerState> = { [DEPLOYMENT]: 'live' }
      const net = network(state)
      const pin = pinned(DEPLOYMENT, NEXT_DEPLOYMENT)
      const resolver = shellResolver(net.fetch, pin.read, ['user-1', 'user-2'])
      await expect(resolver.resolve(KERNEL, live())).resolves.toBe(exchanged(DEPLOYMENT))

      // The Shell is reinstalled from a new deployment while this session keeps its read.
      state[DEPLOYMENT] = stale
      state[NEXT_DEPLOYMENT] = 'live'
      await expect(resolver.resolve(KERNEL, live())).resolves.toBe(
        exchanged(NEXT_DEPLOYMENT, 'user-2'),
      )

      expect(pin.reads).toEqual([SHELL, SHELL])
      expect(
        net.requests.filter((request) => request.endsWith('/.well-known/astrale/token')),
      ).toEqual([
        `domain ${DEPLOYMENT}/.well-known/astrale/token`,
        ...(stale === 'refuses' ? [`domain ${DEPLOYMENT}/.well-known/astrale/token`] : []),
        `domain ${NEXT_DEPLOYMENT}/.well-known/astrale/token`,
      ])
      expect(await installations.get(KERNEL, SHELL)).toEqual({ issuer: NEXT_DEPLOYMENT })
    },
  )

  test('retries a moved issuer only once', async () => {
    const net = network({ [DEPLOYMENT]: 'retired', [NEXT_DEPLOYMENT]: 'retired' })
    const pin = pinned(DEPLOYMENT, NEXT_DEPLOYMENT)

    await expect(shellResolver(net.fetch, pin.read).resolve(KERNEL, live())).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_DISCOVERY_FAILED',
    })
    expect(pin.reads).toEqual([SHELL, SHELL])
    expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([
      `domain ${DEPLOYMENT}/.well-known/openid-configuration`,
      `domain ${NEXT_DEPLOYMENT}/.well-known/openid-configuration`,
    ])
  })

  test('keeps a failure the pin does not explain', async () => {
    const net = network({ [DEPLOYMENT]: 'refuses' })
    const pin = pinned(DEPLOYMENT)

    await expect(shellResolver(net.fetch, pin.read).resolve(KERNEL, live())).rejects.toMatchObject({
      code: '2002',
    })
    expect(pin.reads).toEqual([SHELL, SHELL])
    expect(net.requests.filter((request) => request.endsWith('/token'))).toHaveLength(1)
    expect(await installations.get(KERNEL, SHELL)).toEqual({ issuer: DEPLOYMENT })
  })

  test('does not read the pin again for a failure a moved issuer cannot cause', async () => {
    const net = network({ [DEPLOYMENT]: 'live' }, { cacheControl: false })
    const pin = pinned(DEPLOYMENT, NEXT_DEPLOYMENT)

    await expect(shellResolver(net.fetch, pin.read).resolve(KERNEL, live())).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_PROTOCOL_ERROR',
    })
    expect(pin.reads).toEqual([SHELL])
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-LEGACY-ISSUER-UNCHANGED */
  test('exchanges a Shell still pinned at its stable issuer there, reusing what an earlier release cached', async () => {
    // The previous release exchanged at the route-derived stable issuer and cached the result.
    const earlier = network({ [LEGACY_SHELL]: 'live' })
    await createExchangeCredentialResolver(
      { url: `${KERNEL}/api`, kernelIssuer: KERNEL, domainIssuer: LEGACY_SHELL },
      { resolve: async () => sourceToken('user-1') },
      earlier.fetch,
      5_000,
      credentials,
    ).resolve(KERNEL, live())

    const net = network({})
    const pin = pinned(LEGACY_SHELL)
    await expect(shellResolver(net.fetch, pin.read).resolve(KERNEL, live())).resolves.toBe(
      exchanged(LEGACY_SHELL),
    )
    expect(pin.reads).toEqual([SHELL])
    expect(net.requests).toEqual([`kernel ${INVOCATION} as source`])
    expect(await installations.get(KERNEL, SHELL)).toEqual({ issuer: LEGACY_SHELL })
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-ISSUER-UNRESOLVED */
  test('names why the installed issuer could not be read, without falling back', async () => {
    const refused = new ResponseError(
      3002,
      'Domain shell.astrale.ai is not installed.',
      INVOCATION_ID,
    )
    const net = network({ [LEGACY_SHELL]: 'live' })
    const failing = shellResolver(net.fetch, async () => {
      throw refused
    })

    await expect(failing.resolve(KERNEL, live())).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_ISSUER_UNRESOLVED',
      message: `The issuer of the installed ${SHELL} Domain could not be read from ${KERNEL}.`,
      hint: 'The Kernel refused the installation read with 3002: Domain shell.astrale.ai is not installed.',
      cause: refused,
    })
    await expect(
      shellResolver(net.fetch, pinned('not an issuer').read).resolve(KERNEL, live()),
    ).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_ISSUER_UNRESOLVED',
      hint: expect.stringContaining('The installation read returned an invalid Domain'),
    })
    expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([])
    expect(await installations.get(KERNEL, SHELL)).toBeUndefined()
  })

  test('keeps the caller when the Kernel hosts the Domain itself', async () => {
    const net = network({})
    await expect(shellResolver(net.fetch, pinned(null).read).resolve(KERNEL, live())).resolves.toBe(
      sourceToken('user-1'),
    )
    expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([])
    expect(await installations.get(KERNEL, SHELL)).toEqual({ issuer: null })
  })
})

/** One session whose successive resolutions select `users` in turn; the last one repeats. */
function shellResolver(fetch: Fetch, read: InstalledDomainReader, users = ['user-1']) {
  let resolution = 0
  const user = () => users[Math.min(resolution, users.length - 1)]!
  return createExchangeCredentialResolver(
    TARGET,
    {
      cacheIdentity: async () => ({ issuer: 'https://workos.example', subject: user() }),
      async resolve() {
        const token = sourceToken(user())
        resolution += 1
        return token
      },
    },
    fetch,
    5_000,
    credentials,
    createInstalledIssuer(KERNEL, SHELL, installations, read),
  )
}

/** The pin the Kernel answers with on each successive read; the last one repeats. */
function pinned(...issuers: Array<string | null>) {
  const reads: string[] = []
  const read: InstalledDomainReader = async (session, origin) => {
    reads.push(origin)
    // Stands in for `schema.inspect`: one Kernel call through the same authenticated Session.
    await session.auth.whoami()
    const named = issuers[Math.min(reads.length, issuers.length) - 1]
    return {
      publication: named === null || named === undefined ? null : { identity: { issuer: named } },
    } as Pick<DomainInfo, 'publication'>
  }
  return { read, reads }
}

/** A Kernel answering as the caller of each credential, and Domain issuers in the given states. */
function network(
  issuers: Readonly<Record<string, IssuerState>>,
  options: { readonly cacheControl?: boolean } = {},
) {
  const requests: string[] = []
  const fetch: Fetch = async (input, init) => {
    const url = String(input)
    if (url === INVOCATION) {
      const body = JSON.parse(await new Response(init?.body).text()) as Record<string, any>
      const user = String(credentialSubject(body.credential))
      requests.push(
        `kernel ${url} as ${body.credential.startsWith(SOURCE_HEADER) ? 'source' : 'other'}`,
      )
      return answered(
        url,
        invocation(
          body.requestId,
          body.call.input && Object.keys(body.call.input).length === 0
            ? { id: user }
            : `kernel-destination-envelope:${user}`,
          new Headers(init?.headers).get('accept')!,
        ),
      )
    }
    const domain = Object.keys(issuers).find((candidate) => url.startsWith(`${candidate}/`))
    requests.push(`domain ${url}`)
    const state = domain === undefined ? undefined : issuers[domain]
    if (domain === undefined || state === 'retired') {
      return answered(url, new Response('not found', { status: 404 }))
    }
    if (url.endsWith('/.well-known/openid-configuration')) {
      return answered(url, json(configuration(domain)))
    }
    if (url.endsWith('/.well-known/astrale/token')) {
      if (state === 'refuses') {
        return answered(
          url,
          json(
            { error: { code: 2002, message: 'Token is invalid.' } },
            401,
            'application/vnd.astrale+json',
          ),
        )
      }
      const envelope = new Headers(init?.headers).get('authorization')!.split(':').at(-1)!
      return answered(
        url,
        new Response(
          JSON.stringify({ token: exchanged(domain, envelope), expiresAt: EXPIRES_AT }),
          {
            headers: {
              'content-type': 'application/vnd.astrale+json',
              ...(options.cacheControl === false ? {} : { 'cache-control': 'no-store' }),
            },
          },
        ),
      )
    }
    throw new Error(`unexpected URL ${url}`)
  }
  return { fetch, requests }
}

/** Report the answered URL on each response, as a network fetch does. */
function answered(url: string, response: Response): Response {
  if (response.url === '') Object.defineProperty(response, 'url', { value: url })
  return response
}

function configuration(domain: string) {
  return {
    issuer: domain,
    jwks_uri: `${domain}/.well-known/jwks.json`,
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['EdDSA'],
    token_exchange_endpoint: `${domain}/.well-known/astrale/token`,
  }
}

function invocation(requestId: unknown, result: unknown, contentType: string): Response {
  return new Response(
    JSON.stringify({ requestId, invocation: { source: KERNEL, id: `call-${requestId}` }, result }),
    { headers: { 'content-type': contentType, 'cache-control': 'no-store' } },
  )
}

function json(value: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  })
}

function live(): AbortSignal {
  return new AbortController().signal
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const SOURCE_HEADER = encode({ alg: 'EdDSA', typ: 'JWT', kid: 'source' })

function credentialSubject(token: string): unknown {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub
}

function sourceToken(subject: string): string {
  return `${SOURCE_HEADER}.${encode({
    iss: 'https://workos.example',
    sub: subject,
    aud: KERNEL,
    exp: SOURCE_EXPIRES_AT,
  })}.signature`
}

/** The Domain credential `domain` issues for `user`, carrying exactly that caller's proof. */
function exchanged(domain: string, user = 'user-1'): string {
  const proof = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: KERNEL,
    sub: user,
    aud: KERNEL,
    exp: EXPIRES_AT,
    delegation: { v: 1, expr: { kind: 'identity', id: user } },
  })}.signature`
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: domain,
    sub: 'shell-domain',
    aud: KERNEL,
    exp: EXPIRES_AT,
    grant: { v: 1, expr: { kind: 'identity', credential: proof } },
  })}.signature`
}
