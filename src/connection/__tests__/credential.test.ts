import type { Call } from '@astrale-os/kernel-client'
import type { HostHop } from '@astrale-os/kernel-client/host'

import { issuer, type IssuerId } from '@astrale-os/kernel-core/auth'
import { Path } from '@astrale-os/kernel-core/path'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'

import {
  createCliCredential,
  createConnectionCredential,
  delegationTtlSeconds,
  type SourceAuthClient,
} from '../credential'

const SOURCE = issuer.accept('https://kernel.example')
const OTHER_SOURCE = issuer.accept('https://other-kernel.example')
const DESTINATION = issuer.accept('https://application.example')
const TARGET = {
  kind: 'path',
  path: Path.parse('/:example.dev:function.call').raw,
} satisfies HostHop['target']
type DestinationHop = Extract<HostHop, { readonly kind: 'destination' }>
const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: SOURCE, issuer: SOURCE },
  telemetry: { enabled: false },
}

describe('connection credential', () => {
  /** @evidence TEST-CLI-CONNECTION-RESOLVES-CREDENTIAL-PER-HOP */
  test('resolves each hop for its exact audience and delegates without forwarding', async () => {
    const sourceAudiences: IssuerId[] = []
    const delegations: Array<{ sourceCredential: string; audience: IssuerId }> = []
    const credential = createConnectionCredential(
      SOURCE,
      {
        async resolve(audience) {
          sourceAudiences.push(audience)
          return `source:${audience}`
        },
      },
      {
        async delegate(sourceCredential, audience) {
          delegations.push({ sourceCredential, audience })
          return `delegated:${audience}`
        },
      },
    )
    const signal = new AbortController().signal

    await expect(credential.resolve(sourceHop(SOURCE), signal)).resolves.toBe(`source:${SOURCE}`)
    await expect(credential.resolve(destinationHop(SOURCE, DESTINATION), signal)).resolves.toBe(
      `delegated:${DESTINATION}`,
    )

    expect(sourceAudiences).toEqual([SOURCE, SOURCE])
    expect(delegations).toEqual([{ sourceCredential: `source:${SOURCE}`, audience: DESTINATION }])
    expect(`delegated:${DESTINATION}`).not.toBe(`source:${SOURCE}`)
  })

  /** @evidence TEST-CLI-CONNECTION-REJECTS-HOP-SOURCE-ISSUER-MISMATCH */
  test('rejects source and destination hops outside the selected source issuer', async () => {
    const credential = createConnectionCredential(
      SOURCE,
      {
        async resolve() {
          return 'source'
        },
      },
      {
        async delegate() {
          return 'destination'
        },
      },
    )
    const signal = new AbortController().signal

    await expect(credential.resolve(sourceHop(OTHER_SOURCE), signal)).rejects.toMatchObject({
      code: 'SOURCE_ISSUER_MISMATCH',
    })
    await expect(
      credential.resolve(destinationHop(OTHER_SOURCE, DESTINATION), signal),
    ).rejects.toMatchObject({ code: 'SOURCE_ISSUER_MISMATCH' })
  })

  /** @evidence TEST-CLI-CONNECTION-DELEGATES-VIA-SOURCE-AUTH */
  test('uses the raw source credential only to mint a destination delegation', async () => {
    const sourceCredentials: string[] = []
    const calls: Array<{ readonly target: unknown; readonly input: unknown }> = []
    const sourceClient = {
      as(credential: string) {
        sourceCredentials.push(credential)
        return {
          async call(call: Call) {
            calls.push(call)
            return calls.length === 1
              ? {
                  id: 'identity-id',
                  issuer: SOURCE,
                  subject: 'alice',
                  frozen: false,
                  requiredClaims: [],
                }
              : 'destination-token'
          },
        }
      },
    } satisfies SourceAuthClient
    const credential = createCliCredential(
      { url: `${SOURCE}/invoke`, issuer: SOURCE, slug: 'source' },
      { creds: 'raw-source-token' },
      config,
      sourceClient,
    )
    if (credential === undefined) throw new Error('expected authenticated credential')
    const signal = new AbortController().signal

    await expect(credential.resolve(sourceHop(SOURCE), signal)).resolves.toBe('raw-source-token')
    await expect(credential.resolve(destinationHop(SOURCE, DESTINATION), signal)).resolves.toBe(
      'destination-token',
    )

    expect(sourceCredentials).toEqual(['raw-source-token'])
    expect(calls).toHaveLength(2)
    expect(calls[0]?.input).toEqual({})
    expect(calls[1]?.input).toEqual({
      audience: DESTINATION,
      ttlSeconds: 3_600,
      delegation: { kind: 'identity', self: true },
    })
  })

  /** @evidence TEST-CLI-CONNECTION-OMITS-EXPLICIT-ANONYMOUS-CREDENTIAL */
  test('omits the credential capability for an explicit anonymous session', () => {
    let sourceAuthSelections = 0
    const sourceClient = {
      as() {
        sourceAuthSelections += 1
        throw new Error('anonymous connection must not select source auth')
      },
    } satisfies SourceAuthClient

    const credential = createCliCredential(
      { url: `${SOURCE}/invoke`, issuer: SOURCE, defaultIdentity: 'ambient-default' },
      { anonymous: true },
      config,
      sourceClient,
    )

    expect(credential).toBeUndefined()
    expect(sourceAuthSelections).toBe(0)
  })

  /** @evidence TEST-CLI-CONNECTION-BOUNDS-DELEGATION-TO-SOURCE-EXPIRY */
  test('keeps a destination delegation inside the source credential lifetime', async () => {
    const nowMs = 1_000_000
    const sourceCredential = jwt({ exp: 1_600 })

    expect(delegationTtlSeconds(sourceCredential, nowMs)).toBe(595)
    expect(delegationTtlSeconds(jwt({ exp: 10_000 }), nowMs)).toBe(3_600)
    expect(delegationTtlSeconds('opaque-source-credential', nowMs)).toBe(3_600)
    expect(() => delegationTtlSeconds(jwt({ exp: 1_005 }), nowMs)).toThrow(/too close to expiry/i)
  })
})

function jwt(payload: Record<string, unknown>): string {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encoded({ alg: 'none' })}.${encoded(payload)}.signature`
}

function sourceHop(source: IssuerId): HostHop {
  return {
    kind: 'source',
    issuer: source,
    destination: { transport: 'http', url: 'https://kernel.example/invoke' },
    target: TARGET,
    protocol: 'envelope',
  }
}

function destinationHop(resolver: IssuerId, destination: IssuerId): HostHop {
  return {
    kind: 'destination',
    resolver,
    publication: publication(destination, 'example.dev'),
    destination: { transport: 'http', url: 'https://application.example/invoke' },
    target: TARGET,
    protocol: 'envelope',
  }
}

function publication(issuer: IssuerId, origin: string): DestinationHop['publication'] {
  return {
    origin: origin as DestinationHop['publication']['origin'],
    identity: { issuer, subject: origin },
    revision: `sha256:${'0'.repeat(64)}` as DestinationHop['publication']['revision'],
    etag: '"publication"' as DestinationHop['publication']['etag'],
  }
}
