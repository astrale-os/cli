/**
 * Ed25519 key pair for the minimal-remote worker.
 *
 * This is a SCAFFOLD key — fine to ship to `*.test.astrale.ai` for
 * iteration, but rotate it (and stop committing) before shipping to real prod.
 * Generate a fresh pair with `astrale identity create <name>` (see
 * astrale-cli skill) or any ES256 / EdDSA JWK generator.
 */
export const PRIVATE_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  d: 'dJDtnOsWuhsUJWQ9ScBSxYJg6YXIlMs0lR5JMJgkk_8',
  x: 'HgXZrlEH0oE13gIwqP5GmyRFv2GEICoHGeRvEPwFTv0',
  kid: 'minimal-remote-worker-key',
} as const

export const PUBLIC_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  x: 'HgXZrlEH0oE13gIwqP5GmyRFv2GEICoHGeRvEPwFTv0',
  kid: 'minimal-remote-worker-key',
} as const
