import type { IssuerId } from '@astrale-os/sdk/auth'
import type { ExchangeFailure, Fetch } from '@astrale-os/sdk/client'

import { credential, grant } from '@astrale-os/sdk/auth'
import { ExchangeError } from '@astrale-os/sdk/client'
import { ClientSession } from '@astrale-os/sdk/client/session'

import type { SourceCredentialResolver } from './credential'
import type { ConnectionTarget } from './target'

import { AstraleError } from '../errors'
import { remainingCredentialLifetimeSeconds } from '../lib/credential-lifetime'
import { exchangeCallerProof } from '../lib/exchange-grant'
import { ExchangeCredentialCache } from '../state/exchange-credentials'
import { cachedCredentialTtlSeconds, exchangeCredentialTtlSeconds } from './lifetime'

/** CLI error code of each Client exchange failure; a Domain refusal keeps the Domain's own code. */
const EXCHANGE_FAILURE_CODES: Readonly<Record<Exclude<ExchangeFailure, 'rejected'>, string>> =
  Object.freeze({
    discovery: 'TOKEN_EXCHANGE_DISCOVERY_FAILED',
    unsupported: 'TOKEN_EXCHANGE_UNSUPPORTED',
    unavailable: 'TOKEN_EXCHANGE_UNAVAILABLE',
    'invalid-response': 'TOKEN_EXCHANGE_PROTOCOL_ERROR',
    'source-exhausted': 'TOKEN_EXCHANGE_SOURCE_EXPIRED',
  })

/**
 * Exchange exact authenticated User authority for a Domain bearer bound to this Kernel.
 *
 * The Client owns the exchange itself (`session.exchange`). The CLI keeps what outlives one
 * process: the persisted cache, the command-timeout lifetime rules, and its error codes.
 */
export function createExchangeCredentialResolver(
  target: ConnectionTarget & { readonly domainIssuer: IssuerId },
  source: SourceCredentialResolver,
  fetch: Fetch,
  timeoutMs: number,
  cache = new ExchangeCredentialCache(),
): SourceCredentialResolver {
  requireExchangeTransport(target)
  const cacheTtlSeconds = cachedCredentialTtlSeconds(timeoutMs)
  const exchangeTtlSeconds = exchangeCredentialTtlSeconds(timeoutMs)
  return Object.freeze({
    async resolve(kernelIssuer: IssuerId, signal: AbortSignal): Promise<string> {
      requireLive(signal)
      const hintedIdentity = await readCacheIdentity(source)
      requireLive(signal)
      if (hintedIdentity !== undefined) {
        const cached = await cache.get(
          Object.freeze({
            kernelIssuer,
            domainIssuer: target.domainIssuer,
            sourceIssuer: hintedIdentity.issuer,
            sourceSubject: hintedIdentity.subject,
          }),
          cacheTtlSeconds,
        )
        requireLive(signal)
        if (cached !== undefined) return cached
      }

      const sourceToken = await source.resolve(kernelIssuer, signal)
      const sourceIdentity = sourceCacheIdentity(sourceToken)
      requireLive(signal)

      return await cache.getOrRefresh(
        Object.freeze({
          kernelIssuer,
          domainIssuer: target.domainIssuer,
          sourceIssuer: sourceIdentity.issuer,
          sourceSubject: sourceIdentity.subject,
        }),
        cacheTtlSeconds,
        async () => {
          const ttlSeconds = delegationLifetime(sourceToken, exchangeTtlSeconds)
          const session = new ClientSession({
            kernel: kernelIssuer,
            fetch,
            timeoutMs,
            policy: {
              maximumRouteAgeMs: 60_000,
              ...(new URL(kernelIssuer).protocol === 'http:' ? { allowInsecureHttp: true } : {}),
            },
            auth: { ttlSeconds, resolve: () => ({ credential: sourceToken }) },
          })
          try {
            const exchanged = await exchangeThrough(
              session,
              target.domainIssuer,
              ttlSeconds,
              signal,
            )
            const expiresAt = Math.floor(exchanged.expiresAt / 1_000)
            const caller = carriedCaller(exchanged.credential, expiresAt)
            if (caller.remainingSeconds < cacheTtlSeconds) {
              throw new AstraleError(
                'TOKEN_EXCHANGE_LIFETIME_INSUFFICIENT',
                'The Domain exchange credential cannot cover the requested command timeout.',
                `The Domain issuer returned ${Math.max(0, caller.remainingSeconds)} seconds but ${cacheTtlSeconds} are required. Use a shorter --timeout or update the Domain execution service.`,
              )
            }
            return {
              credential: exchanged.credential,
              expiresAt,
              user: caller.user,
              sourceIssuer: sourceIdentity.issuer,
              sourceSubject: sourceIdentity.subject,
            }
          } finally {
            session.close()
          }
        },
      )
    },
  })
}

/** One Client exchange; a delegation whose Kernel outcome is unknown is safe to request again. */
async function exchangeThrough(
  session: ClientSession,
  domainIssuer: IssuerId,
  ttlSeconds: number,
  signal: AbortSignal,
): Promise<{ readonly credential: string; readonly expiresAt: number }> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await session.exchange(domainIssuer, { ttlSeconds, signal })
    } catch (cause) {
      if (attempt < 2 && unknownFunctionOutcome(cause)) continue
      throw exchangeFailure(cause, domainIssuer)
    }
  }
}

/** Map a Client exchange failure to its CLI code; other failures keep their own identity. */
function exchangeFailure(cause: unknown, domainIssuer: IssuerId): unknown {
  if (!(cause instanceof ExchangeError)) return cause
  if (cause.failure === 'rejected') {
    const refused = (cause.cause as { readonly payload?: { readonly code?: unknown } } | undefined)
      ?.payload
    const message = cause.cause instanceof Error ? cause.cause.message : cause.message
    return refused?.code === undefined
      ? new AstraleError('TOKEN_EXCHANGE_PROTOCOL_ERROR', cause.message, undefined, { cause })
      : new AstraleError(String(refused.code), message, undefined, { cause })
  }
  if (cause.failure === 'unsupported') {
    return new AstraleError(
      EXCHANGE_FAILURE_CODES.unsupported,
      `Domain issuer ${domainIssuer} does not advertise token exchange.`,
      'This command has no legacy token fallback.',
      { cause },
    )
  }
  return new AstraleError(EXCHANGE_FAILURE_CODES[cause.failure], cause.message, undefined, {
    cause,
  })
}

async function readCacheIdentity(
  source: SourceCredentialResolver,
): Promise<Readonly<{ issuer: string; subject: string }> | undefined> {
  try {
    return await source.cacheIdentity?.()
  } catch {
    return undefined
  }
}

function sourceCacheIdentity(sourceToken: string): { issuer: string; subject: string } {
  const inspected = credential.inspect(sourceToken)
  if (
    typeof inspected.iss !== 'string' ||
    inspected.iss.length === 0 ||
    typeof inspected.sub !== 'string' ||
    inspected.sub.length === 0
  ) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_INVALID',
      'The source identity credential has no stable issuer and subject.',
    )
  }
  return Object.freeze({ issuer: inspected.iss, subject: inspected.sub })
}

function unknownFunctionOutcome(cause: unknown): boolean {
  if (cause === null || typeof cause !== 'object') return false
  const error = cause as { readonly code?: unknown; readonly reason?: unknown }
  if (error.code === 5002) return true
  if (error.reason === null || typeof error.reason !== 'object') return false
  return (error.reason as { readonly code?: unknown }).code === 'FUNCTION_OUTCOME_UNKNOWN'
}

function delegationLifetime(sourceToken: string, requiredTtlSeconds: number): number {
  const expiresAt = credential.inspect(sourceToken).claims.exp
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_INVALID',
      'The source identity credential has no valid expiration.',
    )
  }
  const remaining = remainingCredentialLifetimeSeconds(expiresAt)
  if (!Number.isSafeInteger(remaining) || remaining < 1) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_EXPIRED',
      'The source identity credential has no lifetime available for token exchange.',
    )
  }
  if (remaining < requiredTtlSeconds) {
    throw new AstraleError(
      'TOKEN_EXCHANGE_SOURCE_LIFETIME_INSUFFICIENT',
      'The source credential cannot cover the requested command timeout.',
      `Refresh the identity session or use a shorter --timeout; ${remaining} seconds remain but ${requiredTtlSeconds} are required.`,
    )
  }
  return requiredTtlSeconds
}

/**
 * The caller-only Kernel proof the Domain bearer carries, its subject, and how long both the
 * outer bearer and that proof still live.
 */
function carriedCaller(
  token: string,
  outerExpiresAt: number,
): { readonly user: string; readonly remainingSeconds: number } {
  try {
    const inspected = credential.inspect(token)
    const carried = exchangeCallerProof(grant.acceptUnresolved(inspected.claims.grant).expr)
    if (carried === undefined) {
      throw new TypeError('Domain credential does not carry an identity proof.')
    }
    const proof = credential.inspect(carried)
    const proofExpiresAt = proof.claims.exp
    if (typeof proofExpiresAt !== 'number' || !Number.isSafeInteger(proofExpiresAt)) {
      throw new TypeError('Domain credential carries an identity proof without an expiration.')
    }
    if (typeof proof.sub !== 'string' || proof.sub.length === 0) {
      throw new TypeError('Domain credential carries an identity proof without a subject.')
    }
    return Object.freeze({
      user: proof.sub,
      remainingSeconds: remainingCredentialLifetimeSeconds(
        Math.min(outerExpiresAt, proofExpiresAt),
      ),
    })
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause
    throw new AstraleError(
      'TOKEN_EXCHANGE_PROTOCOL_ERROR',
      'Token exchange returned an invalid carried identity proof.',
      cause.message,
    )
  }
}

function requireExchangeTransport(
  target: ConnectionTarget & { readonly domainIssuer: IssuerId },
): void {
  const kernel = new URL(target.kernelIssuer)
  const domain = new URL(target.domainIssuer)
  if (domain.protocol === 'https:') return
  if (domain.protocol === 'http:' && kernel.protocol === 'http:') return
  throw new AstraleError(
    'TOKEN_EXCHANGE_INSECURE',
    'An HTTP Domain issuer is allowed only with an explicitly configured HTTP Kernel target.',
  )
}

function requireLive(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}
