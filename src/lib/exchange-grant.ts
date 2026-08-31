import type { UnresolvedIdentityExpr } from '@astrale-os/sdk/auth'

/** Exact caller proof retained by one caller-only exchange credential. */
export function exchangeCallerProof(expression: UnresolvedIdentityExpr): string | undefined {
  return expression.kind === 'identity' &&
    'credential' in expression &&
    typeof expression.credential === 'string'
    ? expression.credential
    : undefined
}
