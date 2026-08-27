const MINIMUM_CREDENTIAL_TTL_SECONDS = 60
const INVOCATION_RECEIPT_MARGIN_SECONDS = 5
const CACHE_HANDOFF_MARGIN_SECONDS = 5
const TOKEN_EXCHANGE_SETTLEMENT_MARGIN_SECONDS = 15

/** Cover the complete command deadline while preserving the existing short-command floor. */
export function invocationCredentialTtlSeconds(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('Invocation credential timeout must be a positive safe integer.')
  }
  return Math.max(
    MINIMUM_CREDENTIAL_TTL_SECONDS,
    Math.ceil(timeoutMs / 1_000) + INVOCATION_RECEIPT_MARGIN_SECONDS,
  )
}

/** Leave the final carrier lifetime intact after source delegation and issuer exchange settle. */
export function exchangeCredentialTtlSeconds(timeoutMs: number): number {
  return invocationCredentialTtlSeconds(timeoutMs) + TOKEN_EXCHANGE_SETTLEMENT_MARGIN_SECONDS
}

/** Refresh a cached token before the final Session carrier can cross a second boundary. */
export function cachedCredentialTtlSeconds(timeoutMs: number): number {
  return invocationCredentialTtlSeconds(timeoutMs) + CACHE_HANDOFF_MARGIN_SECONDS
}
