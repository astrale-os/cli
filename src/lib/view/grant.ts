import type { ResolvedView } from '@astrale-os/shell'

import { credential, issuer as issuerId, type IssuerId } from '@astrale-os/sdk/auth'

import { viewKeyOrigin } from './resolve'

/**
 * The credentials a View session hands its page. Whatever authority the session holds - a CLI
 * identity, or an instance root token and the impersonation minted from it - stays in the session
 * server: the page only ever receives these short-lived grants.
 */

export type GrantKind = 'minted' | 'exchanged'
export type TokenGrant = { token: string; expiresAt: number; kind: GrantKind }

/** The Shell's own Domain: its Views are the caller's desktop, never a Domain principal between. */
const SHELL_ORIGIN = 'shell.astrale.ai'

/**
 * The issuer of the Domain credential a View runs on, exchanged for the caller; nothing when it runs
 * on a Kernel credential of the caller. Shell's own rule for a root host: a View of a Domain the
 * Kernel executes (no issuer of its own, or the Kernel's) has no Domain principal, and the Shell's
 * own Views act for the caller itself; every other View receives its Domain's credential.
 */
export function exchangedIssuer(view: ResolvedView, kernelIssuer: string): IssuerId | undefined {
  const issuer = view.route.issuer
  if (issuer === undefined || issuer === kernelIssuer) return undefined
  if (viewKeyOrigin(String(view.route.key)) === SHELL_ORIGIN) return undefined
  return issuerId.accept(issuer)
}

/**
 * The issuer's own expiration is the only evidence of this credential's lifetime; the requested TTL
 * is a request, never a grant. Issuance already refuses to return a credential this cannot read, so
 * an unreadable one is a Kernel defect and fails closed rather than carrying an estimate into the
 * browser, where Shell bounds its child delegation by exactly this value.
 */
export function mintedExpiry(token: string): number {
  let claimed: unknown
  try {
    claimed = credential.inspect(token).claims.exp
  } catch (cause) {
    throw new TypeError('The minted View credential could not be read.', { cause })
  }
  if (typeof claimed !== 'number' || !Number.isSafeInteger(claimed)) {
    throw new TypeError('The minted View credential carries no usable expiration.')
  }
  const expiresAt = claimed * 1_000
  if (!Number.isSafeInteger(expiresAt)) {
    throw new TypeError('The minted View credential expiration is out of range.')
  }
  return expiresAt
}
