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
import { decodeJwt, exportJWK, generateKeyPair } from 'jose'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AstraleError } from '../../errors'
import { buildIdentityBinding, inferAlg } from '../domain-identity'

describe('inferAlg', () => {
  // Adversarial: older CLI releases generated ES256 keys without
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

describe('buildIdentityBinding (end-to-end against a committed spec)', () => {
  // From `cli/src/lib/__tests__/` up to the workspace root, then `domains/`.
  const SPEC_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../..',
    'domains/manager-ui/spec.json',
  )

  async function generateES256Jwk(kid: string): Promise<Record<string, unknown>> {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true })
    const jwk = (await exportJWK(privateKey)) as Record<string, unknown>
    jwk.alg = 'ES256'
    jwk.kid = kid
    return jwk
  }

  test('mints a credential whose subs match what the kernel will validate', async () => {
    // The CLI's buildIdentityBinding runs the IDENTICAL `Graph.fromWire →
    // deserializeDomainFromGraph → collectFunctionSubs` pipeline the kernel
    // uses at install validation. This test pins the full mint path against
    // a real committed spec — drift between the CLI and the kernel here
    // would surface as a downstream `subs missing function path …` reject.
    const raw = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as Record<string, unknown>
    const { meta: _meta, ...spec } = raw
    const privateJwk = await generateES256Jwk('cli-e2e')

    const { credential, publicKey } = await buildIdentityBinding(
      spec as unknown as Parameters<typeof buildIdentityBinding>[0],
      privateJwk,
    )

    expect(typeof credential).toBe('string')
    expect(publicKey.jwk.kid).toBe('cli-e2e')
    // The public half MUST NOT carry the private scalar.
    expect(publicKey.jwk.d).toBeUndefined()

    const claims = decodeJwt(credential)
    // iss/aud/sub all equal the domain origin (slug form).
    expect(claims.iss).toBeTypeOf('string')
    expect(claims.iss).toBe(claims.aud as string)
    expect(claims.iss).toBe(claims.sub as string)

    // subs must be a non-empty array of strings.
    const subs = claims.subs as unknown
    expect(Array.isArray(subs)).toBe(true)
    expect((subs as string[]).length).toBeGreaterThan(0)
    expect((subs as unknown[]).every((s) => typeof s === 'string')).toBe(true)
    // Sanity: at least one sub must be scoped under the issuer (a method or
    // core node path of the installed domain).
    expect((subs as string[]).some((s) => s.includes(claims.iss as string))).toBe(true)
  })
})
