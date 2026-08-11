import type { AuthenticatedClient } from '@astrale-os/kernel-client'
import type { HostCredential, HostHop } from '@astrale-os/kernel-client/host'
import type { IssuerId } from '@astrale-os/kernel-core/auth'

import { pathCall } from '@astrale-os/kernel-client'
import { createAuth } from '@astrale-os/kernel-client/auth'

import type { AstraleConfig } from '../lib/config'
import type { ConnectionOptions, ConnectionTarget } from './target'

import { resolveCredential } from '../kernel/auth'

const DELEGATION_TTL_SECONDS = 3_600

export interface SourceCredentialResolver {
  resolve(audience: IssuerId, signal: AbortSignal): Promise<string>
}

export interface DestinationDelegator {
  delegate(sourceCredential: string, audience: IssuerId, signal: AbortSignal): Promise<string>
}

export interface SourceAuthClient {
  as(credential: string): Pick<AuthenticatedClient, 'call'>
}

/** Compose admitted Host hops without carrying a credential across audience boundaries. */
export function createConnectionCredential(
  source: SourceCredentialResolver,
  destination: DestinationDelegator,
): HostCredential {
  const resolveSource = source.resolve.bind(source)
  const delegate = destination.delegate.bind(destination)
  return Object.freeze({
    async resolve(hop: HostHop, signal: AbortSignal): Promise<string> {
      if (hop.kind === 'source') return resolveSource(hop.issuer, signal)
      const sourceCredential = await resolveSource(hop.resolver, signal)
      return delegate(sourceCredential, hop.publication.identity.issuer, signal)
    },
  })
}

/** Bind CLI identity state and Core Auth delegation to one Host credential capability. */
export function createCliCredential(
  target: ConnectionTarget,
  options: ConnectionOptions,
  config: AstraleConfig,
  sourceClient: SourceAuthClient,
): HostCredential {
  const authOptions = Object.freeze({
    ...(options.as === undefined ? {} : { as: options.as }),
    ...(options.creds === undefined ? {} : { creds: options.creds }),
    ...(target.defaultIdentity === undefined ? {} : { defaultIdentity: target.defaultIdentity }),
  })
  return createConnectionCredential(
    {
      async resolve(audience, signal) {
        requireLive(signal)
        const credential = await resolveCredential(authOptions, config, audience, target.slug)
        requireLive(signal)
        return credential
      },
    },
    {
      async delegate(sourceCredential, audience, signal) {
        const authenticated = sourceClient.as(sourceCredential)
        const auth = createAuth((path, input, request) =>
          authenticated.call(pathCall(path, input), { ...request, signal }),
        )
        const self = await auth.whoami({ signal })
        return auth.delegate(
          self.id,
          {
            audience,
            ttlSeconds: DELEGATION_TTL_SECONDS,
            delegation: { kind: 'identity', self: true },
          },
          { signal },
        )
      },
    },
  )
}

function requireLive(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}
