import type { UnresolvedIdentityExpr } from '@astrale-os/sdk/auth'

/** Exact caller proof retained by caller-only and trusted union exchange credentials. */
export function exchangeCallerProof(expression: UnresolvedIdentityExpr): string | undefined {
  if (expression.kind === 'identity') {
    return 'credential' in expression && typeof expression.credential === 'string'
      ? expression.credential
      : undefined
  }
  if (expression.kind !== 'union' || expression.operands.length !== 2) return undefined

  let caller: string | undefined
  let self = false
  for (const operand of expression.operands) {
    if (operand.kind !== 'identity') return undefined
    if ('credential' in operand && typeof operand.credential === 'string') {
      if (caller !== undefined) return undefined
      caller = operand.credential
      continue
    }
    if ('self' in operand && operand.self === true) {
      if (self) return undefined
      self = true
      continue
    }
    return undefined
  }
  return self ? caller : undefined
}
