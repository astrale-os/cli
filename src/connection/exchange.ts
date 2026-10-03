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
import { createInstalledIssuer } from './installed-issuer'
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
 * CLI codes of the exchange failures an issuer that moved since it was read causes: it no longer
 * serves an exchange (issuer unknown), or the Domain refuses the delegation (2002 AUTH_INVALID).
 */
const MOVED_ISSUER_CODES: ReadonlySet<string> = new Set([
  EXCHANGE_FAILURE_CODES.discovery,
  EXCHANGE_FAILURE_CODES.unsupported,
  EXCHANGE_FAILURE_CODES.unavailable,
  '2002',
])

/**
 * A target that names where its selected identity is exchanged: an exact Domain issuer, or the
 * origin of the installed Domain whose issuer the source Kernel's pin names.
 */
export type ExchangeTarget = ConnectionTarget &
  (
    | { readonly domainIssuer: IssuerId }
    | { readonly domainIssuer?: undefined; readonly domainOrigin: string }
  )

/** Where one target exchanges its selected identity. */
export interface ExchangeIssuer {
  /**
   * The issuer a persisted credential may be selected with before any network I/O: an exact
   * issuer, or one this session already read; never an issuer remembered across commands.
   */
  known(): Promise<IssuerId | undefined>
  /** The issuer to exchange at; null when the Domain runs on the Kernel and the caller stays itself. */
  current(session: () => ClientSession, signal: AbortSignal): Promise<IssuerId | null>
  /**
   * After an exchange at `failed` failed as a moved issuer would: the issuer to retry at, or
   * undefined when the failure stands (the pin still names `failed`, or it cannot be read again).
   */
  moved(
    failed: IssuerId,
    session: () => ClientSession,
    signal: AbortSignal,
  ): Promise<IssuerId | null | undefined>
}

/**
 * Exchange exact authenticated User authority for a Domain bearer bound to this Kernel.
 *
 * The Client owns the exchange itself (`session.exchange`). The CLI keeps what outlives one
 * process: the persisted cache, the command-timeout lifetime rules, and its error codes. A target
 * naming an installed Domain by origin exchanges at the issuer its pin names, read once per session
 * by `installed`; an exact issuer ignores `installed`.
 */
export function createExchangeCredentialResolver(
  target: ExchangeTarget,
  source: SourceCredentialResolver,
  fetch: Fetch,
  timeoutMs: number,
  cache = new ExchangeCredentialCache(),
  installed?: ExchangeIssuer,
): SourceCredentialResolver {
  const domain =
    target.domainIssuer === undefined
      ? (installed ?? createInstalledIssuer(target.kernelIssuer, target.domainOrigin))
      : exactIssuer(target.domainIssuer)
  if (target.domainIssuer !== undefined) {
    requireExchangeTransport(target.kernelIssuer, target.domainIssuer)
  }
  const cacheTtlSeconds = cachedCredentialTtlSeconds(timeoutMs)
  const exchangeTtlSeconds = exchangeCredentialTtlSeconds(timeoutMs)
  return Object.freeze({
    async resolve(kernelIssuer: IssuerId, signal: AbortSignal): Promise<string> {
      requireLive(signal)
      const hintedIdentity = await readCacheIdentity(source)
      requireLive(signal)
      const known = await domain.known()
      requireLive(signal)
      const persisted = async (identity: SourceIdentity) => {
        if (known === undefined) return undefined
        const cached = await cache.get(exchangeKey(kernelIssuer, known, identity), cacheTtlSeconds)
        requireLive(signal)
        return cached
      }
      if (hintedIdentity !== undefined) {
        const cached = await persisted(hintedIdentity)
        if (cached !== undefined) return cached
      }

      const sourceToken = await source.resolve(kernelIssuer, signal)
      const sourceIdentity = sourceCacheIdentity(sourceToken)
      requireLive(signal)
      if (!sameIdentity(hintedIdentity, sourceIdentity)) {
        const cached = await persisted(sourceIdentity)
        if (cached !== undefined) return cached
      }

      const exchange = sourceSession(
        kernelIssuer,
        sourceToken,
        fetch,
        timeoutMs,
        exchangeTtlSeconds,
      )
      const exchangeAt = (domainIssuer: IssuerId) => {
        requireExchangeTransport(kernelIssuer, domainIssuer)
        return cache.getOrRefresh(
          exchangeKey(kernelIssuer, domainIssuer, sourceIdentity),
          cacheTtlSeconds,
          async () => {
            const { session, ttlSeconds } = exchange.open()
            const exchanged = await exchangeThrough(session, domainIssuer, ttlSeconds, signal)
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
          },
        )
      }
      const session = () => exchange.open().session
      try {
        const current = await domain.current(session, signal)
        requireLive(signal)
        // A Domain the Kernel hosts has no issuer to exchange at: the caller stays itself.
        if (current === null) return sourceToken
        try {
          return await exchangeAt(current)
        } catch (failure) {
          if (!issuerMayHaveMoved(failure)) throw failure
          const moved = await domain.moved(current, session, signal)
          requireLive(signal)
          if (moved === undefined) throw failure
          return moved === null ? sourceToken : await exchangeAt(moved)
        }
      } finally {
        exchange.close()
      }
    },
  })
}

/** An exact issuer is never re-read: its failures stand. */
function exactIssuer(domainIssuer: IssuerId): ExchangeIssuer {
  return Object.freeze({
    known: async () => domainIssuer,
    current: async () => domainIssuer,
    moved: async () => undefined,
  })
}

function issuerMayHaveMoved(failure: unknown): boolean {
  return failure instanceof AstraleError && MOVED_ISSUER_CODES.has(failure.code)
}

type SourceIdentity = Readonly<{ issuer: string; subject: string }>

function exchangeKey(kernelIssuer: IssuerId, domainIssuer: IssuerId, identity: SourceIdentity) {
  return Object.freeze({
    kernelIssuer,
    domainIssuer,
    sourceIssuer: identity.issuer,
    sourceSubject: identity.subject,
  })
}

function sameIdentity(left: SourceIdentity | undefined, right: SourceIdentity): boolean {
  return left?.issuer === right.issuer && left.subject === right.subject
}

/**
 * One Client Session per resolution, authenticated as the source caller: it reads the installed
 * issuer and runs the exchange, and opens only when either needs it.
 */
function sourceSession(
  kernelIssuer: IssuerId,
  sourceToken: string,
  fetch: Fetch,
  timeoutMs: number,
  exchangeTtlSeconds: number,
) {
  let opened: Readonly<{ session: ClientSession; ttlSeconds: number }> | undefined
  return Object.freeze({
    open() {
      if (opened !== undefined) return opened
      const ttlSeconds = delegationLifetime(sourceToken, exchangeTtlSeconds)
      opened = Object.freeze({
        ttlSeconds,
        session: new ClientSession({
          kernel: kernelIssuer,
          fetch,
          timeoutMs,
          policy: {
            maximumRouteAgeMs: 60_000,
            ...(new URL(kernelIssuer).protocol === 'http:' ? { allowInsecureHttp: true } : {}),
          },
          auth: { ttlSeconds, resolve: () => ({ credential: sourceToken }) },
        }),
      })
      return opened
    },
    close() {
      opened?.session.close()
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
): Promise<SourceIdentity | undefined> {
  try {
    return await source.cacheIdentity?.()
  } catch {
    return undefined
  }
}

function sourceCacheIdentity(sourceToken: string): SourceIdentity {
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

function requireExchangeTransport(kernelIssuer: IssuerId, domainIssuer: IssuerId): void {
  const kernel = new URL(kernelIssuer)
  const domain = new URL(domainIssuer)
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
