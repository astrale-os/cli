import type { ResolvedView } from '@astrale-os/shell'

import { credential } from '@astrale-os/sdk/auth'

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
 * Whether a View runs on a Kernel credential of the caller rather than on its Domain's exchanged
 * credential. Shell's own rule for a root host: a View the Kernel itself issues has no Domain
 * principal, and the Shell's own Views act for the caller itself; every other View receives its
 * Domain's credential, exchanged for the caller.
 */
export function runsOnKernelCredential(view: ResolvedView, kernelIssuer: string): boolean {
  return (
    view.route.issuer === kernelIssuer || viewKeyOrigin(String(view.route.key)) === SHELL_ORIGIN
  )
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
