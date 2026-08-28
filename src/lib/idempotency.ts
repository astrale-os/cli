const MAXIMUM_KEY_LENGTH = 128
const URL_SAFE_KEY = /^[A-Za-z0-9._~-]+$/u

/** Build one protocol-compatible key for an operation that may cross nested Kernel calls. */
export function idempotencyKey(...segments: readonly string[]): string {
  const value = segments.join('.')
  if (value.length < 1 || value.length > MAXIMUM_KEY_LENGTH || !URL_SAFE_KEY.test(value)) {
    throw new TypeError('Idempotency key must contain 1-128 URL-safe ASCII characters.')
  }
  return value
}

/** Generate a fresh operation id while retaining a short diagnostic namespace. */
export function randomOperationId(...namespace: readonly string[]): string {
  return idempotencyKey(...namespace, globalThis.crypto.randomUUID())
}

/** Derive one stable bounded key from caller-controlled material without normalizing collisions. */
export async function derivedIdempotencyKey(namespace: string, material: string): Promise<string> {
  idempotencyKey(namespace)
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)),
  )
  const hexadecimal = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return idempotencyKey(namespace, hexadecimal)
}
