import type { UnresolvedIdentityExpr } from '@astrale-os/sdk/auth'

/** Exact caller proof retained only by a caller-only Domain exchange credential. */
export function exchangeCallerProof(expression: UnresolvedIdentityExpr): string | undefined {
  return expression.kind === 'identity' &&
    'credential' in expression &&
    typeof expression.credential === 'string'
    ? expression.credential
    : undefined
}
