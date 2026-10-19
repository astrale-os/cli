import type { SessionAuth } from '@astrale-os/sdk/client/session'

import { credential, issuer, type IssuerId } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AstraleConfig } from '../../lib/config'
import type { ExchangeIssuer } from '../exchange'

import { bindCredentialIdentity } from '../auth'
import { createCliCredential, createConnectionCredential } from '../credential'

const SOURCE = issuer.accept('https://kernel.example')
const TARGET_CALL = Object.freeze({
  target: Path.parse('/:example.dev:function.call').raw,
  input: { value: 1 },
}) satisfies Parameters<SessionAuth['resolve']>[0]
const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: SOURCE, kernelIssuer: SOURCE },
  telemetry: { enabled: false, analyzerEnabled: false },
  browser: {},
}

describe('connection credential', () => {
  /** @evidence TEST-CLI-CONNECTION-USES-PERSISTED-EXCHANGE-BEFORE-SOURCE-REFRESH */
  test('selects the named, bookmark or default identity and its exact persisted exchange', async () => {
    expect(await runFixture('exchange-cache-cli-process.ts')).toEqual({
      explicit: true,
      active: true,
      foreign: false,
      fetches: 0,
      registered: { iss: 'https://kernel.example/iss/registered', sub: 'registered-node' },
      root: { iss: 'https://kernel.example', sub: 'system' },
    })
  })

  /** @evidence TEST-CLI-CONNECTION-REFUSES-UNREGISTERED-KEY-IDENTITY */
  test('refuses a key identity with no registration on the target Kernel and nothing else to sign as', async () => {
    expect(await runFixture('unregistered-key-identity.ts')).toEqual({
      refused: {
        code: 'AUTH_ERROR',
        message: 'Identity "ci" has no registration for Kernel https://other.example/api.',
        hint: expect.stringContaining('astrale identity register ci --node @<identity-node-id>'),
      },
      registered: { iss: 'https://registered.example/api/iss/thumbprint', sub: 'self' },
      configured: { iss: 'https://cli.example', sub: 'ci' },
    })
  })

  test.each(['EACCES', 'EPERM', 'EROFS'])(
    'reports a session lock the filesystem refuses (%s) as that file, never as an ended session',
    async (code) => {
      const failure = await runFixture('session-file-refused.ts', code)
      const lockPath = String(failure.lockPath)

      expect(failure).toMatchObject({
        code: 'AUTH_ERROR',
        message: `Could not refresh the IdP session for "alice": access to ${lockPath} was refused (${code}).`,
        hint: expect.stringContaining(`can read and write ${lockPath} and its directory`),
      })
      expect(`${failure.message} ${failure.hint}`).not.toMatch(/auth login|expired|ended/)
    },
  )

  test('pins the bookmark identity while leaving explicit credentials unnamed', async () => {
    const target = { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE, defaultIdentity: 'owner' }
    await expect(bindCredentialIdentity({}, target)).resolves.toEqual({ as: 'owner' })
    await expect(bindCredentialIdentity({ creds: 'opaque' }, target)).resolves.toEqual({
      creds: 'opaque',
    })
  })

  /** @evidence TEST-CLI-CONNECTION-RESOLVES-SOURCE-AUTH-BEFORE-ROUTING */
  /** @evidence TEST-CLI-CONNECTION-BOUNDS-REMOTE-CARRIER-TO-SOURCE-LIFETIME */
  /** @evidence TEST-CLI-CONNECTION-CARRIER-COVERS-COMMAND-TIMEOUT */
  test.each([
    ['an opaque source', 'opaque', 60, { credential: 'opaque' }],
    ['a two-minute source', 120, 60, { delegate: { ttlSeconds: 60 } }],
    ['a five-minute source', 300, 185, { delegate: { ttlSeconds: 185 } }],
    ['a two-minute source', 120, 185, 'CREDENTIAL_LIFETIME_INSUFFICIENT'],
    ['an expired source', -30, 60, 'CREDENTIAL_LIFETIME_INSUFFICIENT'],
  ] as const)(
    'delegates from %s at the source issuer for a %i-second carrier only within its lifetime',
    async (_case, expiresIn, carrier, outcome) => {
      const source = expiresIn === 'opaque' ? 'opaque' : token(now() + expiresIn)
      const audiences: IssuerId[] = []
      const auth = createConnectionCredential(
        SOURCE,
        { resolve: async (audience) => (audiences.push(audience), source) },
        carrier,
      )
      const resolved = auth.resolve(TARGET_CALL, new AbortController().signal)
      if (typeof outcome === 'string')
        await expect(resolved).rejects.toMatchObject({ code: outcome })
      else await expect(resolved).resolves.toEqual({ credential: source, ...outcome })
      expect(audiences).toEqual([SOURCE])
    },
  )

  test('derives the carrier lifetime from the command timeout, raised for a nested credential', () => {
    const target = { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE }
    const domain = { ...target, domainIssuer: issuer.accept('https://admin.example') }
    expect(createCliCredential(target, {}, config, undefined, 180_000)?.ttlSeconds).toBe(185)
    expect(createCliCredential(domain, {}, config, undefined, 180_000)?.ttlSeconds).toBe(185)
    const nested = { principal: 'caller', nestedTtlSeconds: 240 } as const
    expect(createCliCredential(target, {}, config, undefined, 30_000, nested)?.ttlSeconds).toBe(275)
    expect(() =>
      createCliCredential(domain, {}, config, undefined, 30_000, {
        nestedTtlSeconds: 240,
      } as never),
    ).toThrow('Nested credential issuance requires the caller principal')
  })

  /** @evidence TEST-CLI-CONNECTION-CALLER-PRINCIPAL-SKIPS-DOMAIN-EXCHANGE */
  test('preserves the selected human principal for nested credentials on a managed target', async () => {
    const domainIssuer = issuer.accept('https://admin.example')
    const source = token(now() + 600, 'dispatcher')
    let minimumRemainingSeconds = 0
    const auth = createCliCredential(
      { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE, domainIssuer },
      { as: 'dispatcher' },
      config,
      untouched,
      30_000,
      { principal: 'caller', nestedTtlSeconds: 240 },
      async (options) => {
        minimumRemainingSeconds = options.minimumRemainingSeconds ?? 0
        return source
      },
    )
    const resolved = await auth!.resolve(TARGET_CALL, new AbortController().signal)
    expect(resolved).toEqual({ credential: source, delegate: { ttlSeconds: 275 } })
    expect(minimumRemainingSeconds).toBe(275)
    expect(credential.inspect(resolved.credential!).claims.sub).toBe('dispatcher')
  })

  /** @evidence TEST-CLI-CONNECTION-INSTALLED-ISSUER-SERVES-EXCHANGE */
  test('exchanges for a callable Domain where the issuer the command owner hands it says', async () => {
    const source = token(now() + 600, 'installed-origin-user')
    const asked: string[] = []
    const installed: ExchangeIssuer = {
      known: async () => void asked.push('known'),
      // A Domain the Kernel hosts: the caller stays itself, so nothing is sent.
      current: async () => (asked.push('current'), null),
      moved: async () => void asked.push('moved'),
    }
    const auth = createCliCredential(
      {
        url: `${SOURCE}/invoke`,
        kernelIssuer: SOURCE,
        domainIssuer: issuer.accept('https://services.example'),
      },
      {},
      config,
      untouched,
      30_000,
      {},
      async () => source,
      installed,
    )
    const resolved = await auth!.resolve(TARGET_CALL, new AbortController().signal)
    expect(resolved.credential).toBe(source)
    expect(asked).toEqual(['known', 'current'])
  })

  /** @evidence TEST-CLI-CONNECTION-USES-RAW-SOURCE-CREDENTIAL */
  test.each([
    [
      'a raw source credential is presented as it is',
      'raw-source-token',
      30_000,
      'raw-source-token',
    ],
    [
      'an explicit bearer needs only the command window',
      30,
      5_000,
      { delegate: { ttlSeconds: 10 } },
    ],
    [
      'an explicit bearer must cover its receipt margin',
      8,
      5_000,
      'CREDENTIAL_LIFETIME_INSUFFICIENT',
    ],
    [
      'an explicit Domain bearer is refused before exchange I/O',
      120,
      180_000,
      'CREDENTIAL_LIFETIME_INSUFFICIENT',
    ],
  ] as const)('%s', async (_case, bearer, timeoutMs, outcome) => {
    const creds = typeof bearer === 'string' ? bearer : token(now() + bearer)
    const auth = createCliCredential(
      {
        url: `${SOURCE}/invoke`,
        kernelIssuer: SOURCE,
        domainIssuer: issuer.accept('https://admin.example'),
      },
      { creds },
      config,
      untouched,
      timeoutMs,
    )
    const resolved = auth!.resolve(TARGET_CALL, new AbortController().signal)
    if (outcome === 'CREDENTIAL_LIFETIME_INSUFFICIENT')
      await expect(resolved).rejects.toMatchObject({ code: outcome })
    else if (typeof outcome === 'string')
      await expect(resolved).resolves.toEqual({ credential: outcome })
    else await expect(resolved).resolves.toEqual({ credential: creds, ...outcome })
  })

  /** @evidence TEST-CLI-CONNECTION-OMITS-EXPLICIT-ANONYMOUS-CREDENTIAL */
  test('omits the auth capability for an explicit anonymous session', () => {
    const target = { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE, defaultIdentity: 'ambient' }
    expect(createCliCredential(target, { anonymous: true }, config)).toBeUndefined()
  })

  /** @evidence TEST-CLI-CONNECTION-PROPAGATES-AUTH-CANCELLATION */
  test('passes the live Session operation signal to source credential resolution', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const auth = createConnectionCredential(SOURCE, {
      async resolve(_audience, signal) {
        expect(signal).toBe(controller.signal)
        throw signal.reason
      },
    })
    controller.abort(reason)
    await expect(auth.resolve(TARGET_CALL, controller.signal)).rejects.toBe(reason)
  })
})

/** Run a `fixtures/` process under its own ASTRALE_HOME and parse the JSON it prints. */
async function runFixture(name: string, ...args: string[]): Promise<Record<string, unknown>> {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-connection-fixture-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures', name), ...args], {
      env: { ...process.env, ASTRALE_HOME: directory },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    return JSON.parse(stdout) as Record<string, unknown>
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** A Fetch that a credential resolved without network I/O never calls. */
const untouched = async (): Promise<Response> => {
  throw new Error('network must remain untouched')
}

function now(): number {
  return Math.ceil(Date.now() / 1_000)
}

function token(exp: number, sub = 'principal'): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: SOURCE,
    sub,
    aud: SOURCE,
    exp,
  })}.signature`
}
