import type { AuthenticatedClient } from '@astrale-os/kernel-client'
import type { HostCredential, HostHop } from '@astrale-os/kernel-client/host'
import type { IssuerId } from '@astrale-os/kernel-core/auth'

import { pathCall } from '@astrale-os/kernel-client'
import { createAuth } from '@astrale-os/kernel-client/auth'
import { decodeJwt } from 'jose'

import type { AstraleConfig } from '../lib/config'
import type { ConnectionOptions, ConnectionTarget } from './target'

import { AstraleError, AuthError } from '../errors'
import { resolveCredential } from './auth'
import { registrationKeyForTarget } from './target'

const DELEGATION_TTL_SECONDS = 3_600
const DELEGATION_EXPIRY_MARGIN_SECONDS = 5

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
  expectedSourceIssuer: IssuerId,
  source: SourceCredentialResolver,
  destination: DestinationDelegator,
): HostCredential {
  const resolveSource = source.resolve.bind(source)
  const delegate = destination.delegate.bind(destination)
  return Object.freeze({
    async resolve(hop: HostHop, signal: AbortSignal): Promise<string> {
      if (hop.kind === 'source') {
        requireSourceIssuer(hop.issuer, expectedSourceIssuer)
        return resolveSource(expectedSourceIssuer, signal)
      }
      requireSourceIssuer(hop.resolver, expectedSourceIssuer)
      const audience = hop.publication.identity.issuer
      const sourceCredential = await resolveSource(expectedSourceIssuer, signal)
      return delegate(sourceCredential, audience, signal)
    },
  })
}

/** Bind CLI identity state and Core Auth delegation to one Host credential capability. */
export function createCliCredential(
  target: ConnectionTarget,
  options: ConnectionOptions,
  config: AstraleConfig,
  sourceClient: SourceAuthClient,
): HostCredential | undefined {
  validateCredentialSelection(options)
  if (options.anonymous === true) return undefined
  const authOptions = Object.freeze({
    ...(options.as === undefined ? {} : { as: options.as }),
    ...(options.creds === undefined ? {} : { creds: options.creds }),
    ...(target.defaultIdentity === undefined ? {} : { defaultIdentity: target.defaultIdentity }),
  })
  return createConnectionCredential(
    target.issuer,
    {
      async resolve(audience, signal) {
        requireLive(signal)
        const credential = await resolveCredential(
          authOptions,
          config,
          audience,
          registrationKeyForTarget(target),
        )
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
            ttlSeconds: delegationTtlSeconds(sourceCredential),
            delegation: { kind: 'identity', self: true },
          },
          { signal },
        )
      },
    },
  )
}

/** Reject contradictory explicit credential selections before identity or network access. */
export function validateCredentialSelection(options: ConnectionOptions): void {
  if (options.anonymous !== true) return
  const conflicting = [
    ...(options.as === undefined ? [] : ['--as']),
    ...(options.creds === undefined ? [] : ['--creds']),
  ]
  if (conflicting.length === 0) return
  throw new AstraleError(
    'INVALID_FLAG',
    `--anonymous cannot be combined with ${conflicting.join(' or ')}.`,
  )
}

/** Keep a destination credential strictly inside the unverified source JWT expiry hint. */
export function delegationTtlSeconds(sourceCredential: string, nowMs = Date.now()): number {
  let expiresAt: number | undefined
  try {
    expiresAt = decodeJwt(sourceCredential).exp
  } catch {
    return DELEGATION_TTL_SECONDS
  }
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return DELEGATION_TTL_SECONDS
  }
  const remaining =
    Math.floor(expiresAt) - Math.ceil(nowMs / 1_000) - DELEGATION_EXPIRY_MARGIN_SECONDS
  if (remaining < 1) {
    throw new AuthError(
      'Source credential has expired or is too close to expiry for delegation.',
      'Acquire a fresh source credential and retry.',
    )
  }
  return Math.min(DELEGATION_TTL_SECONDS, remaining)
}

function requireSourceIssuer(actual: IssuerId, expected: IssuerId): void {
  if (actual === expected) return
  throw new AstraleError(
    'SOURCE_ISSUER_MISMATCH',
    `Host hop source issuer "${actual}" does not match selected issuer "${expected}".`,
  )
}

function requireLive(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}
