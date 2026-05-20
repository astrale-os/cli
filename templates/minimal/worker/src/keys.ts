/**
 * Ed25519 key pair for the astrale-domain worker.
 *
 * Placeholder key. `astrale domain init` overwrites this file at scaffold
 * time via `writeWorkerKeysFile` (cli/src/lib/domain-scaffold.ts), so every
 * generated domain gets its own fresh, internally-consistent pair. Still a
 * dev key — rotate before real prod.
 */
export const PRIVATE_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  d: 'oUqtLVXUXeHebjcZsVpNgcU5yrAPr996R-dTbZkutkI',
  x: 'GkaTTc1CMPvRKHTjH4auDDFMdwdnn1yj2QvFBAzJfQ0',
  kid: 'astrale-domain-worker-key',
} as const

export const PUBLIC_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  x: 'GkaTTc1CMPvRKHTjH4auDDFMdwdnn1yj2QvFBAzJfQ0',
  kid: 'astrale-domain-worker-key',
} as const
