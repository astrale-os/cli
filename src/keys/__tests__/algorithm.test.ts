import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { inferAlg } from '../algorithm'

describe('inferAlg', () => {
  test('returns explicit alg when present', () => {
    expect(inferAlg({ alg: 'ES256' })).toBe('ES256')
    expect(inferAlg({ alg: 'EdDSA' })).toBe('EdDSA')
  })

  /** @evidence TEST-CLI-KEYS-INFERS-LEGACY-ALGORITHM */
  test('infers supported algorithms for legacy unstamped key files', () => {
    expect(inferAlg({ kty: 'EC', crv: 'P-256' })).toBe('ES256')
    expect(inferAlg({ kty: 'OKP', crv: 'Ed25519' })).toBe('EdDSA')
  })

  test('explicit alg wins over inferable shape (no second-guessing)', () => {
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
