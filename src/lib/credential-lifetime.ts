/** Whole seconds safely available after second-boundary rounding and carrier handoff. */
export function remainingCredentialLifetimeSeconds(
  expiresAtEpochSeconds: number,
  nowEpochSeconds = Math.ceil(Date.now() / 1_000),
): number {
  if (!Number.isSafeInteger(expiresAtEpochSeconds) || !Number.isSafeInteger(nowEpochSeconds)) {
    throw new TypeError('Credential expiration and current time must be safe epoch seconds.')
  }
  return expiresAtEpochSeconds - nowEpochSeconds - 1
}

export function credentialLifetimeCovers(
  expiresAtEpochSeconds: number,
  minimumRemainingSeconds: number,
  nowEpochSeconds?: number,
): boolean {
  if (!Number.isSafeInteger(minimumRemainingSeconds) || minimumRemainingSeconds < 1) {
    throw new TypeError('Credential minimum lifetime must be a positive safe integer.')
  }
  return (
    remainingCredentialLifetimeSeconds(expiresAtEpochSeconds, nowEpochSeconds) >=
    minimumRemainingSeconds
  )
}
