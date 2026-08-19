import { AstraleError } from '../errors'

/**
 * Resolve the JOSE algorithm to use with this key. Prefers `privateJwk.alg`
 * when present, falls back to inferring from `crv`/`kty` so keys generated
 * by older CLIs that did not stamp `alg`. Throws when neither form resolves.
 */
export function inferAlg(privateJwk: Record<string, unknown>, keyPath?: string): string {
  const explicit = privateJwk.alg
  if (typeof explicit === 'string' && explicit.length > 0) {
    if (explicit === 'ES256' || explicit === 'EdDSA') return explicit
    throw unsupportedAlgorithm(explicit, keyPath)
  }
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

function unsupportedAlgorithm(algorithm: string, keyPath?: string): AstraleError {
  const where = keyPath ? ` at ${keyPath}` : ''
  return new AstraleError(
    'INVALID_KEY_FILE',
    `JWK${where} selects unsupported signing algorithm ${JSON.stringify(algorithm)}.`,
    'Use an ES256 P-256 key or an EdDSA Ed25519 key.',
  )
}
