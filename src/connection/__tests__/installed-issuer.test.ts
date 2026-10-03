import type { Fetch } from '@astrale-os/sdk/client'
import type { DomainInfo } from '@astrale-os/sdk/client/schema'

import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError, TransportError } from '@astrale-os/sdk/client'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { pack } from 'msgpackr'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AstraleConfig } from '../../lib/config'
import type { InstalledDomainReader } from '../installed-issuer'
import type { ConnectionContext, ConnectionFactory } from '../session'

import { ExchangeCredentialCache } from '../../state/exchange-credentials'
import { InstallationCache } from '../../state/installations'
import { createExchangeCredentialResolver } from '../exchange'
import { classifyFailure } from '../failure/classify'
import { createInstalledIssuer } from '../installed-issuer'
import { withResolvedClientSession } from '../session'

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

/** How the fake source Kernel answers: as each caller, refusing every call, or unreachable. */
type KernelState =
  | { readonly kind: 'up'; readonly pin?: () => string | null }
  | { readonly kind: 'refuses'; readonly code: number; readonly reason?: unknown }
  | { readonly kind: 'down' }

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

    // The next command is a new process: it reads no pin, resolves no source credential and sends
    // nothing; it selects the credential persisted under the issuer the pin named.
    const next = network({})
    const reread = pinned(DEPLOYMENT)
    let sourceResolutions = 0
    const nextProcess = createExchangeCredentialResolver(
      TARGET,
      {
        cacheIdentity: async () => ({ issuer: 'https://workos.example', subject: 'user-1' }),
        async resolve() {
          sourceResolutions += 1
          return sourceToken('user-1')
        },
      },
      next.fetch,
      5_000,
      credentials,
      createInstalledIssuer(KERNEL, SHELL, installations, reread.read),
    )
    await expect(nextProcess.resolve(KERNEL, live())).resolves.toBe(exchanged(DEPLOYMENT))
    expect(reread.reads).toEqual([])
    expect(sourceResolutions).toBe(0)
    expect(next.requests).toEqual([])
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-STALE-ISSUER-RECOVERS-ONCE */
  test.each(['retired', 'refuses'] as const)(
    'a fresh exchange at an issuer this session read and the pin no longer names (%s) reads the pin once more and retries once',
    async (stale) => {
      const state: Record<string, IssuerState> = { [DEPLOYMENT]: 'live' }
      const net = network(state)
      const pin = pinned(DEPLOYMENT, NEXT_DEPLOYMENT)
      // A second user of the same session has no credential yet, so it exchanges afresh at the
      // issuer this session read; a later command reads the pin afresh (the reinstall case below).
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
  })

  test('keeps the exchange failure and what was read when the pin cannot be read again', async () => {
    const net = network({ [DEPLOYMENT]: 'retired' })
    const unavailable = new ResponseError(5001, 'Backend is unavailable.', INVOCATION_ID)
    const pin = pinned(DEPLOYMENT, unavailable)
    const resolver = shellResolver(net.fetch, pin.read)

    await expect(resolver.resolve(KERNEL, live())).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_DISCOVERY_FAILED',
    })
    expect(pin.reads).toEqual([SHELL, SHELL])

    // This session's read stands: the next resolution exchanges at the same issuer again.
    await expect(resolver.resolve(KERNEL, live())).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_DISCOVERY_FAILED',
    })
    expect(pin.reads).toEqual([SHELL, SHELL, SHELL])
    expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([
      `domain ${DEPLOYMENT}/.well-known/openid-configuration`,
      `domain ${DEPLOYMENT}/.well-known/openid-configuration`,
    ])
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-READ-ONCE-PER-BOOKMARK */
  test('reads the pin once per bookmark across commands, against the bytes a .117 Host encodes', async () => {
    // The Shell 1Pact pins today (shell-v2) answers at the stable issuer; the fake Kernel answers
    // exactly the DomainInfo bytes Host 0.12.0-beta.113 to .126 encode for it.
    expect(sha256(pack(domainInfo(SHELL, LEGACY_SHELL)))).toBe(HOST_DOMAIN_INFO_SHA256.legacy)
    const shell = shellCommand({ [LEGACY_SHELL]: 'live' }, () => LEGACY_SHELL)

    for (let command = 0; command < 5; command += 1) {
      await expect(shell.run()).resolves.toBe(exchanged(LEGACY_SHELL))
    }

    expect(shell.inspects()).toEqual([`kernel ${INVOCATION} inspect ${SHELL} as source`])
    expect(shell.exchanges()).toEqual([`domain ${LEGACY_SHELL}/.well-known/astrale/token`])
    expect(await installations.get(KERNEL, SHELL)).toEqual({ issuer: LEGACY_SHELL })
  })

  test('serves what the callable path read of the Shell installation, the same fact', async () => {
    await installations.set(KERNEL, SHELL, { issuer: DEPLOYMENT })
    const shell = shellCommand({ [DEPLOYMENT]: 'live' }, () => DEPLOYMENT)

    await expect(shell.run()).resolves.toBe(exchanged(DEPLOYMENT))
    expect(shell.inspects()).toEqual([])
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-REINSTALL-HEALS-IN-ONE-RETRY */
  test('after a Shell reinstall, the first command presenting the remembered credential fails once and the retry exchanges at the new issuer', async () => {
    const shell = shellCommand({ [DEPLOYMENT]: 'live' }, () => DEPLOYMENT)
    await expect(shell.run()).resolves.toBe(exchanged(DEPLOYMENT))
    await expect(shell.run()).resolves.toBe(exchanged(DEPLOYMENT))
    expect(shell.inspects()).toHaveLength(1)

    // The Shell is reinstalled from a new deployment, outside the window in which the Kernel still
    // admits what the previous issuer issued: it now rejects that credential with 2002.
    shell.reinstall(NEXT_DEPLOYMENT, { [DEPLOYMENT]: 'retired', [NEXT_DEPLOYMENT]: 'live' })

    // The credential exchanged at the old issuer is still persisted and within its lifetime, and the
    // record still names its issuer: the next command presents it, fails once and forgets the record.
    await expect(shell.run()).rejects.toMatchObject({ code: 2002 })
    expect(await installations.get(KERNEL, SHELL)).toBeUndefined()

    // The retry reads the new pin, exchanges there, and later commands read nothing again.
    await expect(shell.run()).resolves.toBe(exchanged(NEXT_DEPLOYMENT))
    await expect(shell.run()).resolves.toBe(exchanged(NEXT_DEPLOYMENT))
    expect(shell.inspects()).toHaveLength(2)
    expect(shell.exchanges()).toEqual([
      `domain ${DEPLOYMENT}/.well-known/astrale/token`,
      `domain ${NEXT_DEPLOYMENT}/.well-known/astrale/token`,
    ])
  })

  test('heals within the command when the remembered issuer no longer serves an exchange', async () => {
    const shell = shellCommand({ [DEPLOYMENT]: 'live' }, () => DEPLOYMENT)
    await expect(shell.run()).resolves.toBe(exchanged(DEPLOYMENT))

    // A user with no persisted credential exchanges afresh at the remembered issuer, which the
    // reinstall retired: the command reads the pin once more and retries once, at the new issuer.
    shell.reinstall(NEXT_DEPLOYMENT, { [DEPLOYMENT]: 'retired', [NEXT_DEPLOYMENT]: 'live' })
    await expect(shell.run('user-2')).resolves.toBe(exchanged(NEXT_DEPLOYMENT, 'user-2'))
    expect(shell.inspects()).toHaveLength(2)
    expect(await installations.get(KERNEL, SHELL)).toEqual({ issuer: NEXT_DEPLOYMENT })

    // The first user's credential from the old issuer is never selected again.
    await expect(shell.run()).resolves.toBe(exchanged(NEXT_DEPLOYMENT))
    expect(shell.inspects()).toHaveLength(2)
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-STALE-ISSUER-NEVER-SENT-TWICE */
  test('never sends a stale remembered issuer twice, even while the old deployment still exchanges', async () => {
    // The record names an earlier deployment; the Shell now runs from the next one, while the
    // earlier deployment is retained and still answers exchanges the Kernel no longer admits.
    await installations.set(KERNEL, SHELL, { issuer: DEPLOYMENT })
    const shell = shellCommand(
      { [DEPLOYMENT]: 'live', [NEXT_DEPLOYMENT]: 'live' },
      () => NEXT_DEPLOYMENT,
    )

    await expect(shell.run()).rejects.toMatchObject({ code: 2002 })
    for (let command = 0; command < 3; command += 1) {
      await expect(shell.run()).resolves.toBe(exchanged(NEXT_DEPLOYMENT))
      await expect(shell.run('user-2')).resolves.toBe(exchanged(NEXT_DEPLOYMENT, 'user-2'))
    }

    expect(shell.presented().filter((issuer) => issuer === DEPLOYMENT)).toHaveLength(1)
    expect(shell.exchanges().filter((request) => request.includes(DEPLOYMENT))).toHaveLength(1)
    expect(shell.inspects()).toHaveLength(1)
  })

  test('forgets the remembered issuer after any failure of a command that relied on it', async () => {
    const shell = shellCommand({ [DEPLOYMENT]: 'live' }, () => DEPLOYMENT)
    await expect(shell.run()).resolves.toBe(exchanged(DEPLOYMENT))

    // A failure the Shell's issuer did not cause still forgets it: one more read is the cost.
    await expect(shell.run('user-1', new Error('query failed'))).rejects.toThrow('query failed')
    expect(await installations.get(KERNEL, SHELL)).toBeUndefined()
    await expect(shell.run()).resolves.toBe(exchanged(DEPLOYMENT))
    expect(shell.inspects()).toHaveLength(2)

    // A command that read the pin itself keeps what it read when it fails.
    await installations.delete(KERNEL, SHELL)
    await expect(shell.run('user-1', new Error('query failed'))).rejects.toThrow('query failed')
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

    // Later commands read the pin no more, as the route-derived issuer needed no read.
    await expect(shellResolver(net.fetch, pin.read).resolve(KERNEL, live())).resolves.toBe(
      exchanged(LEGACY_SHELL),
    )
    expect(pin.reads).toEqual([SHELL])
    expect(net.requests).toEqual([`kernel ${INVOCATION} as source`])
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-ISSUER-UNRESOLVED */
  test('names why the installed issuer could not be read, without falling back', async () => {
    // What the Kernel answers `schema.inspect` for an origin it has not installed.
    const refused = new ResponseError(1003, 'Domain was not found.', INVOCATION_ID, {
      code: 'SCHEMA_NOT_FOUND',
      details: { origin: SHELL },
    })
    const net = network({ [LEGACY_SHELL]: 'live' })
    const failing = shellResolver(net.fetch, async () => {
      throw refused
    })

    await expect(failing.resolve(KERNEL, live())).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_ISSUER_UNRESOLVED',
      message: `The issuer of the installed ${SHELL} Domain could not be read from ${KERNEL}.`,
      hint: 'The Kernel refused the installation read with 1003 (SCHEMA_NOT_FOUND): Domain was not found.',
      cause: refused,
    })
    const notReady = new ResponseError(1003, 'Domain is not ready.', INVOCATION_ID, {
      code: 'SCHEMA_NOT_READY',
      details: { origin: SHELL },
    })
    await expect(
      shellResolver(net.fetch, async () => {
        throw notReady
      }).resolve(KERNEL, live()),
    ).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_ISSUER_UNRESOLVED', cause: notReady })
    await expect(
      shellResolver(net.fetch, pinned('not an issuer').read).resolve(KERNEL, live()),
    ).rejects.toMatchObject({
      code: 'TOKEN_EXCHANGE_ISSUER_UNRESOLVED',
      hint: expect.stringContaining('The installation read returned an invalid Domain'),
    })
    expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([])
  })

  /** @evidence TEST-CLI-INSTALLED-SHELL-READ-FAILURE-KEEPS-CLASSIFICATION */
  test.each([
    [{ kind: 'refuses', code: 2002 } as const, 2002],
    [{ kind: 'refuses', code: 5001 } as const, 5001],
    // A 1003 that rejects the read's own input says nothing about the installation. This is the
    // reason the Kernel's rejectInput answers for a non-canonical origin.
    [
      {
        kind: 'refuses',
        code: 1003,
        reason: {
          code: 'FUNCTION_INPUT_INVALID',
          details: {
            issues: [
              {
                code: 'ORIGIN_INVALID',
                path: '/origin',
                message: 'Installation origin must be canonical.',
              },
            ],
          },
        },
      } as const,
      1003,
    ],
    [{ kind: 'down' } as const, 'TRANSPORT_ERROR'],
  ])(
    'keeps a read failure that is not about the installation as the Kernel reported it (%o)',
    async (kernel, code) => {
      const net = network({ [DEPLOYMENT]: 'live' }, { kernel })
      const pin = pinned(DEPLOYMENT)

      const failure = await shellResolver(net.fetch, pin.read)
        .resolve(KERNEL, live())
        .then(
          () => undefined,
          (error: unknown) => error,
        )

      // The Client failure itself, as the source caller's first Kernel call has always reported it.
      expect(failure).toBeInstanceOf(kernel.kind === 'down' ? TransportError : ResponseError)
      expect(classifyFailure(failure).code).toBe(code)
      expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([])
    },
  )

  /** @evidence TEST-CLI-INSTALLED-SHELL-INSPECT-DECODED */
  test.each([
    ['a deployment issuer', DEPLOYMENT, HOST_DOMAIN_INFO_SHA256.deployment],
    ['the stable issuer', LEGACY_SHELL, HOST_DOMAIN_INFO_SHA256.legacy],
    ['no publication', null, HOST_DOMAIN_INFO_SHA256.kernelHosted],
  ] as const)(
    'reads the pin with schema.inspect and decodes the DomainInfo every supported Host encodes (%s)',
    async (_case, pin, hostBytes) => {
      // The fake Kernel answers exactly the bytes Host releases 0.12.0-beta.113 to .126 encode.
      expect(sha256(pack(domainInfo(SHELL, pin)))).toBe(hostBytes)
      const net = network(
        { [DEPLOYMENT]: 'live', [LEGACY_SHELL]: 'live' },
        { kernel: { kind: 'up', pin: () => pin } },
      )
      const resolver = createExchangeCredentialResolver(
        TARGET,
        { resolve: async () => sourceToken('user-1') },
        net.fetch,
        5_000,
        credentials,
        createInstalledIssuer(KERNEL, SHELL),
      )

      await expect(resolver.resolve(KERNEL, live())).resolves.toBe(
        pin === null ? sourceToken('user-1') : exchanged(pin),
      )
      expect(net.requests[0]).toBe(`kernel ${INVOCATION} inspect ${SHELL} as source`)
    },
  )

  test.each([
    ['no publication', null],
    ['the source Kernel as its issuer', KERNEL],
  ])('keeps the caller when the Kernel hosts the Domain itself (%s)', async (_case, answer) => {
    const net = network({})
    const pin = pinned(answer)
    await expect(shellResolver(net.fetch, pin.read).resolve(KERNEL, live())).resolves.toBe(
      sourceToken('user-1'),
    )
    expect(pin.reads).toEqual([SHELL])
    expect(net.requests.filter((request) => request.startsWith('domain'))).toEqual([])
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

type ShellContext = ConnectionContext & { readonly present: () => Promise<string> }

/**
 * Commands as fresh processes do them: each one a new resolver over the on-disk caches, run through
 * the connection lifecycle with the on-disk installation cache, which hands the factory the
 * installed issuer. The pin is read with the production reader from a fake Kernel answering the
 * Host-encoded DomainInfo for the issuer `installed()` names, and the Kernel admits only a
 * credential that issuer issued, rejecting any other with 2002.
 */
function shellCommand(issuers: Record<string, IssuerState>, initial: () => string) {
  let installed = initial
  const state = { ...issuers }
  const net = network(state, { kernel: { kind: 'up', pin: () => installed() } })
  const presented: string[] = []
  const command = (user: string, failure?: Error): ConnectionFactory => {
    return (target, _timeoutMs, _options, _config, _credential, issuer) => {
      const resolver = createExchangeCredentialResolver(
        TARGET,
        {
          cacheIdentity: async () => ({ issuer: 'https://workos.example', subject: user }),
          resolve: async () => sourceToken(user),
        },
        net.fetch,
        5_000,
        credentials,
        issuer,
      )
      const context = {
        target,
        async present() {
          const credential = await resolver.resolve(KERNEL, live())
          presented.push(String(credentialIssuer(credential)))
          if (credentialIssuer(credential) !== installed()) {
            throw new ResponseError(2002, 'Credential is invalid.', INVOCATION_ID)
          }
          if (failure !== undefined) throw failure
          return credential
        },
      }
      return { context: context as unknown as ShellContext, close() {} }
    }
  }
  return {
    run: (user = 'user-1', failure?: Error) =>
      withResolvedClientSession(
        TARGET,
        {},
        {} as AstraleConfig,
        (context) => (context as ShellContext).present(),
        command(user, failure),
        {},
        installations,
      ),
    reinstall(next: string, issuers: Record<string, IssuerState>) {
      installed = () => next
      Object.assign(state, issuers)
    },
    inspects: () => net.requests.filter((request) => request.includes(' inspect ')),
    exchanges: () =>
      net.requests.filter((request) => request.endsWith('/.well-known/astrale/token')),
    presented: () => presented,
  }
}

/**
 * The pin the Kernel answers with on each successive read (the last one repeats): an issuer, null
 * for a Domain the Kernel hosts, a refusal, or whatever a function names at the time of the read.
 */
function pinned(...answers: Array<string | null | Error | (() => string | null)>) {
  const reads: string[] = []
  const read: InstalledDomainReader = async (session, origin) => {
    reads.push(origin)
    // Stands in for `schema.inspect`: one Kernel call through the same authenticated Session.
    await session.auth.whoami()
    const answer = answers[Math.min(reads.length, answers.length) - 1]
    if (answer instanceof Error) throw answer
    const named = typeof answer === 'function' ? answer() : answer
    return {
      publication: named === null || named === undefined ? null : { identity: { issuer: named } },
    } as Pick<DomainInfo, 'publication'>
  }
  return { read, reads }
}

/** A source Kernel in the given state, and Domain issuers in the given states. */
function network(
  issuers: Readonly<Record<string, IssuerState>>,
  options: { readonly cacheControl?: boolean; readonly kernel?: KernelState } = {},
) {
  const requests: string[] = []
  const kernel = options.kernel ?? { kind: 'up' }
  const fetch: Fetch = async (input, init) => {
    const url = String(input)
    if (url === INVOCATION) {
      if (kernel.kind === 'down') {
        requests.push(`kernel ${url} unreachable`)
        throw new TypeError('fetch failed')
      }
      const body = JSON.parse(await new Response(init?.body).text()) as Record<string, any>
      const user = String(credentialSubject(body.credential))
      const call = body.call.input as Record<string, unknown> | undefined
      const inspected = call?.kind === 'inspect' ? ` inspect ${String(call.origin)}` : ''
      requests.push(
        `kernel ${url}${inspected} as ${body.credential.startsWith(SOURCE_HEADER) ? 'source' : 'other'}`,
      )
      const contentType = new Headers(init?.headers).get('accept')!
      if (kernel.kind === 'refuses') {
        return answered(url, refusal(body.requestId, kernel.code, contentType, kernel.reason))
      }
      if (inspected !== '' && kernel.pin !== undefined) {
        return answered(url, introspection(body.requestId, String(call!.origin), kernel.pin()))
      }
      return answered(
        url,
        invocation(
          body.requestId,
          call && Object.keys(call).length === 0
            ? { id: user }
            : `kernel-destination-envelope:${user}`,
          contentType,
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

function refusal(
  requestId: unknown,
  code: number,
  contentType: string,
  reason?: unknown,
): Response {
  return new Response(
    JSON.stringify({
      requestId,
      invocation: { source: KERNEL, id: `call-${requestId}` },
      error: {
        code,
        message: 'Refused by the Kernel.',
        ...(reason === undefined ? {} : { data: reason }),
      },
    }),
    { headers: { 'content-type': contentType, 'cache-control': 'no-store' } },
  )
}

/**
 * SHA-256 of the DomainInfo each Host release from 0.12.0-beta.113 to 0.12.0-beta.126 encodes, in
 * its own image, for `domainInfo(SHELL, issuer)`: the oldest Host still serving managed Instances
 * answers these bytes.
 */
const HOST_DOMAIN_INFO_SHA256 = {
  deployment: '71e17ffc54e25ffb100b2482353d3b0121d063708112458e81aeac7cc89dce8f',
  legacy: '7e055e973d4712de1ddd853555d00a53dc590e934fd32e653e97974212e9e6e1',
  kernelHosted: '0af1e689db279a0727dba10c0e37344e7747ec74cee0bfc4f88ac68a7fb38bf0',
} as const

/** The DomainInfo of a Kernel whose pin for `origin` names `pinnedIssuer`, or no publication. */
function domainInfo(origin: string, pinnedIssuer: string | null) {
  const revision = `sha256:${'a'.repeat(64)}`
  return {
    origin,
    revision,
    generation: `sha256:${'b'.repeat(64)}`,
    publication:
      pinnedIssuer === null
        ? null
        : {
            origin,
            identity: { issuer: pinnedIssuer, subject: origin },
            revision,
            etag: `sha256:${'c'.repeat(64)}`,
          },
    readiness: `sha256:${'d'.repeat(64)}`,
    capabilities: { requested: {}, materialized: {} },
    bindings: { callables: [], views: [] },
  }
}

/** The binary `schema.inspect` answer of a Kernel whose pin names `pinnedIssuer`. */
function introspection(requestId: unknown, origin: string, pinnedIssuer: string | null): Response {
  return new Response(new Uint8Array(pack(domainInfo(origin, pinnedIssuer))), {
    headers: {
      'content-type': 'application/vnd.astrale.schema-introspection.v2+msgpack',
      'cache-control': 'no-store',
      'x-astrale-request-id': String(requestId),
      'x-astrale-binary-headers': '-',
      'x-astrale-invocation': `${encodeURIComponent(KERNEL)};call-${requestId}`,
    },
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
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

function credentialIssuer(token: string): unknown {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).iss
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
