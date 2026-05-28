import type { WireGraph } from '@astrale-os/kernel-core'

import { Graph } from '@astrale-os/kernel-core'
import { collectFunctionSubs, deserializeDomainFromGraph } from '@astrale-os/kernel-core/domain'
import { exportJWK, importJWK, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { AstraleError } from '../errors'

// Wire form of an install spec — the JSON shape produced by `buildSpec` and
// consumed by `domains.install`. Aliased to the canonical kernel-core type
// so callers don't re-derive via `Parameters<typeof Graph.fromWire>[0]`.
type Spec = WireGraph

type IdentityBinding = {
  credential: string
  publicKey: { jwk: Record<string, unknown> }
}

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

export async function buildIdentityBinding(
  spec: Spec,
  privateJwk: Record<string, unknown>,
  keyPath?: string,
): Promise<IdentityBinding> {
  // Deserialize the spec the SAME WAY the kernel will at install
  // (`Graph.fromWire` → `deserializeDomainFromGraph` →
  // `registerFunctionIdentities` → `resolveCallables`). Going through the
  // identical pipeline guarantees the minted `subs` claim matches the set
  // the kernel validates against — drift = 0 by construction.
  const compiled = deserializeDomainFromGraph(Graph.fromWire(spec))
  const slug = compiled.$.origin
  const subs = collectFunctionSubs(compiled)

  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicJwk } = privateJwk

  const alg = inferAlg(privateJwk, keyPath)
  const kid = privateJwk.kid as string
  // `extractable: true` lets us re-export the private JWK to derive its
  // canonical public half and cross-check against the `x`/`y` shipped in
  // the file — historical templates had mismatched public components which
  // made every downstream `signature verification failed` impossible to
  // diagnose from the error alone.
  const key = await importJWK(privateJwk, alg, { extractable: true })
  await assertKeyPairConsistent(key, publicJwk, keyPath)

  const credential = await new SignJWT({ subs })
    .setProtectedHeader({ alg, kid })
    .setIssuer(slug)
    .setSubject(slug)
    .setAudience(slug)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)

  return { credential, publicKey: { jwk: publicJwk } }
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

/**
 * Cross-check the public components in the file against what can be
 * derived from the private scalar. Catches broken pairs (`d` and `x` from
 * two different keypairs) before they bubble up as a server-side
 * `signature verification failed`.
 */
async function assertKeyPairConsistent(
  key: Parameters<typeof exportJWK>[0],
  fileJwk: Record<string, unknown>,
  keyPath?: string,
): Promise<void> {
  let derived: Record<string, unknown>
  try {
    derived = (await exportJWK(key)) as Record<string, unknown>
  } catch {
    // exportJWK can only fail on non-extractable keys. We imported with
    // `extractable: true` so this is effectively unreachable — swallow
    // and let the downstream verify produce its own error if it hits one.
    return
  }
  const publicFields = ['x', 'y', 'n', 'e'] as const
  for (const field of publicFields) {
    if (derived[field] === undefined) continue
    if (fileJwk[field] !== undefined && fileJwk[field] !== derived[field]) {
      const where = keyPath ? ` at ${keyPath}` : ''
      throw new AstraleError(
        'INVALID_KEY_PAIR',
        `Private and public components don't match${where} — field \`${field}\` derived from \`d\` is "${String(derived[field])}" but the file says "${String(fileJwk[field])}".`,
        'Regenerate the pair (e.g. delete worker/src/keys.ts and re-scaffold via `astrale domain init`), or replace both halves with a matching keypair.',
      )
    }
  }
}
