import type { Call } from '@astrale-os/kernel-client'
import type { HostHop } from '@astrale-os/kernel-client/host'

import { issuer, type IssuerId } from '@astrale-os/kernel-core/auth'
import { Path } from '@astrale-os/kernel-core/path'
import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'

import {
  createCliCredential,
  createConnectionCredential,
  type SourceAuthClient,
} from '../credential'

const SOURCE = issuer.accept('https://kernel.example')
const DESTINATION = issuer.accept('https://application.example')
const TARGET = {
  kind: 'path',
  path: Path.parse('/:example.dev:function.call').raw,
} satisfies HostHop['target']
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
})

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
  type DestinationHop = Extract<HostHop, { readonly kind: 'destination' }>
  type PublicationRef = DestinationHop['publication']
  return {
    kind: 'destination',
    resolver,
    publication: {
      origin: 'example.dev' as PublicationRef['origin'],
      identity: { issuer: destination, subject: 'application' },
      revision: `sha256:${'0'.repeat(64)}` as PublicationRef['revision'],
      etag: '"publication"' as PublicationRef['etag'],
    },
    destination: { transport: 'http', url: 'https://application.example/invoke' },
    target: TARGET,
    protocol: 'envelope',
  } satisfies DestinationHop
}
