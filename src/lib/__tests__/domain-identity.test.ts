/**
 * `inferAlg` regression tests.
 *
 * (The historical `collectFunctionSubs` adversarial suite — 15 cases that
 * pinned the raw-spec edge-walker against both wire forms / both member
 * namespaces — was removed when the CLI converged onto the kernel's
 * canonical resolver. Subs derivation now runs the IDENTICAL
 * `Graph.fromWire` → `deserializeDomainFromGraph` → `collectFunctionSubs`
 * pipeline the kernel uses at install validation, so drift is impossible
 * by construction. The contract is pinned by
 * `kernel/core/__tests__/domain/resolve-callables-agreement.test.ts`.)
 */

import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { inferAlg } from '../domain-identity'

describe('inferAlg', () => {
  // Adversarial: `astrale init` historically generated ES256 keys without
  // stamping `alg`. Every fresh-machine `astrale instance install` then
  // crashed with "alg is required when jwk.alg is not present" because the
  // CLI read `privateJwk.alg as string` directly and handed `undefined` to
  // jose's importJWK. The fix sets `alg` at keygen time AND falls back to
  // inferring from `crv`/`kty` for already-issued keys (META_TRACE #34).

  test('returns explicit alg when present', () => {
    expect(inferAlg({ alg: 'ES256' })).toBe('ES256')
    expect(inferAlg({ alg: 'EdDSA' })).toBe('EdDSA')
  })

  test('infers ES256 from P-256 EC keys (crv + kty) when alg is missing', () => {
    expect(inferAlg({ kty: 'EC', crv: 'P-256' })).toBe('ES256')
  })

  test('infers EdDSA from Ed25519 OKP keys (crv + kty) when alg is missing', () => {
    expect(inferAlg({ kty: 'OKP', crv: 'Ed25519' })).toBe('EdDSA')
  })

  test('explicit alg wins over inferable shape (no second-guessing)', () => {
    // If a file says ES256 but has Ed25519 components, that's a broken
    // file — don't silently override. assertKeyPairConsistent will catch
    // the mismatch downstream.
    expect(inferAlg({ alg: 'ES256', kty: 'OKP', crv: 'Ed25519' })).toBe('ES256')
  })

  test('throws AstraleError with hint when no alg/crv/kty resolves', () => {
    expect(() => inferAlg({})).toThrow(AstraleError)
    expect(() => inferAlg({ kty: 'EC' })).toThrow(AstraleError)
    expect(() => inferAlg({ kty: 'EC', crv: 'P-384' })).toThrow(AstraleError)
  })

  test('error message includes keyPath when provided', () => {
    expect(() => inferAlg({}, '/path/to/broken.jwk')).toThrow(/\/path\/to\/broken\.jwk/)
  })

  test('treats empty-string alg as missing', () => {
    expect(inferAlg({ alg: '', kty: 'EC', crv: 'P-256' })).toBe('ES256')
  })
})
