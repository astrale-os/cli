import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Name of the env var used to propagate the API token to the manager process. */
export const API_TOKEN_ENV = 'ASTRALE_API_TOKEN'

/** Query param / header name the browser uses to present the token. */
export const API_TOKEN_PARAM = 'token'
export const API_TOKEN_HEADER = 'x-astrale-token'

/** Generate a fresh url-safe API token (256 bits of entropy). */
export function generateApiToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Constant-time compare to avoid timing-based token extraction. */
export function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
