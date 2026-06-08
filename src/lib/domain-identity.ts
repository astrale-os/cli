import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { AstraleError } from '../errors'

export async function loadPrivateJwk(keyPath: string): Promise<Record<string, unknown>> {
  const filePath = resolve(keyPath)
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

/**
 * True when the kernel rejected an `installDomain` call because the
 * identity binding's signature failed to verify — i.e. the private/public
 * JWK halves don't match. Callers re-throw with a regenerate-the-keypair
 * hint instead of leaking the raw `AuthenticationError`.
 */
export function isSignatureVerificationError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const name = (e as { name?: unknown }).name
  const msg = (e as { message?: unknown }).message
  return (
    name === 'AuthenticationError' &&
    typeof msg === 'string' &&
    /signature verification failed/i.test(msg)
  )
}

/**
 * Resolve the JOSE algorithm to use with this key. Prefers `privateJwk.alg`
 * when present, falls back to inferring from `crv`/`kty` so keys generated
 * by older CLIs (which didn't stamp `alg`) keep working without manual
 * editing — see META_TRACE #34. Throws a clean error if neither path
 * resolves an algorithm.
 */
export function inferAlg(privateJwk: Record<string, unknown>, keyPath?: string): string {
  const explicit = privateJwk.alg
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const crv = privateJwk.crv
  const kty = privateJwk.kty
  if (kty === 'EC' && crv === 'P-256') return 'ES256'
  if (kty === 'OKP' && crv === 'Ed25519') return 'EdDSA'
  const where = keyPath ? ` at ${keyPath}` : ''
  throw new AstraleError(
    'INVALID_KEY_FILE',
    `JWK${where} is missing both \`alg\` and a recognizable \`(kty, crv)\` pair — cannot pick a signing algorithm.`,
    'Re-stamp the file with `"alg": "ES256"` (P-256 EC keys) or `"alg": "EdDSA"` (Ed25519 OKP keys), or regenerate via `astrale domain init` / `astrale identity create`.',
  )
}
