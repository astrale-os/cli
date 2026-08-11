import { generateKeyPair, exportJWK, importJWK, SignJWT, type JWK } from 'jose'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, access, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { IdentityKeyMissingError } from '../errors'
import { atomicWrite, KEYS_DIR } from '../state/index'
import { inferAlg } from './algorithm'

const LEGACY_MANAGER_PRIVATE = 'manager.private.jwk'
const LEGACY_MANAGER_PUBLIC = 'manager.public.jwk'

// Default issuer/audience for the host-mode manager's own credential. The
// manager kernel mounts at `/host` (the reserved host slug — SPEC §5.2).
const DEFAULT_MANAGER_ISSUER = 'http://localhost:4400/host'

type AuthOptions = {
  readonly issuer?: string
  readonly subject?: string
  readonly kid?: string
}

export type AuthBinding = {
  readonly credential: string
  readonly publicKey: { readonly jwk: JWK }
}

export type KeypairPaths = {
  readonly privatePath: string
  readonly publicPath: string
}

/**
 * Per-identity keypair paths. `manager` stays on the legacy filenames so
 * existing installs keep working; other subjects use `<subject>.*.jwk`.
 */
export function keypairPaths(subject: string, keysDir: string = KEYS_DIR): KeypairPaths {
  if (subject === 'manager') {
    return {
      privatePath: join(keysDir, LEGACY_MANAGER_PRIVATE),
      publicPath: join(keysDir, LEGACY_MANAGER_PUBLIC),
    }
  }
  return {
    privatePath: join(keysDir, `${subject}.private.jwk`),
    publicPath: join(keysDir, `${subject}.public.jwk`),
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

/** List identity names that have a private key on disk. */
export async function listIdentityKeys(keysDir: string = KEYS_DIR): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(keysDir)
    const names = new Set<string>()
    for (const entry of entries) {
      if (entry === LEGACY_MANAGER_PRIVATE) names.add('manager')
      else if (entry.endsWith('.private.jwk')) names.add(entry.replace(/\.private\.jwk$/, ''))
    }
    return Array.from(names).sort()
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Generate a fresh Ed25519 keypair as plain JWKs (not persisted).
 *
 * Used by the domain scaffold to stamp worker key files with a real,
 * internally-consistent pair — defense against drift between `d` and `x`
 * (historical template copies had a mismatched `x`, making every scaffold
 * inherit a broken pair). Same crypto as ES256 elsewhere in the CLI but
 * EdDSA/Ed25519 matches the worker runtime convention.
 */
export async function generateEd25519Jwk(
  kid: string,
): Promise<{ readonly privateJwk: JWK; readonly publicJwk: JWK }> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  })
  const privateJwk = await exportJWK(privateKey)
  const publicJwk = await exportJWK(publicKey)
  privateJwk.alg = 'EdDSA'
  publicJwk.alg = 'EdDSA'
  privateJwk.kid = kid
  publicJwk.kid = kid
  return { privateJwk, publicJwk }
}

/**
 * Generate a new keypair for `subject`, persist atomically with 0o600
 * perms, and return the JWKs + kid. Overwrites any existing keys.
 */
export async function persistKeypair(
  subject: string,
  opts?: { readonly keysDir?: string; readonly kid?: string },
): Promise<{ readonly publicJwk: JWK; readonly privateJwk: JWK; readonly kid: string }> {
  const keysDir = opts?.keysDir ?? KEYS_DIR
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)
  await mkdir(keysDir, { recursive: true })

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const privateJwk = await exportJWK(privateKey)
  const kid = opts?.kid ?? `${subject}-key-${randomUUID().slice(0, 8)}`
  publicJwk.kid = kid
  privateJwk.kid = kid
  publicJwk.alg = 'ES256'
  privateJwk.alg = 'ES256'

  await atomicWrite(privatePath, JSON.stringify(privateJwk, null, 2))
  await atomicWrite(publicPath, JSON.stringify(publicJwk, null, 2))

  return { publicJwk, privateJwk, kid }
}

/** Remove a subject's keypair files. Idempotent. */
export async function removeKeypair(subject: string, keysDir: string = KEYS_DIR): Promise<void> {
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)
  for (const p of [privatePath, publicPath]) {
    try {
      await unlink(p)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }
}

async function loadSigningMaterial(
  subject: string,
  keysDir: string,
): Promise<{ privateJwk: JWK; publicJwk: JWK; kid: string }> {
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)

  if (await fileExists(privatePath)) {
    const privateJwk = JSON.parse(await readFile(privatePath, 'utf-8')) as JWK
    const publicJwk = JSON.parse(await readFile(publicPath, 'utf-8')) as JWK
    return {
      privateJwk,
      publicJwk,
      kid: (privateJwk.kid as string | undefined) ?? `${subject}-key`,
    }
  }
  throw new IdentityKeyMissingError(subject)
}

/**
 * Sign a self-identity credential (`grant: identity/self`) from a private
 * JWK. Shared by `persistAuth`, `loadAuth`, and `signAs` so the protected
 * header and claim set stay identical across all three; the only thing that
 * varies is how each caller obtains the key material and which
 * subject/audience it stamps.
 */
async function signIdentityCredential(args: {
  privateJwk: JWK
  kid: string
  issuer: string
  subject: string
  audience: string
}): Promise<string> {
  const alg = inferAlg(args.privateJwk as Record<string, unknown>)
  const privateKey = await importJWK(args.privateJwk, alg)
  return new SignJWT({ grant: { v: 1, expr: { kind: 'identity', self: true } } })
    .setProtectedHeader({ alg, kid: args.kid })
    .setIssuer(args.issuer)
    .setSubject(args.subject)
    .setAudience(args.audience)
    .sign(privateKey)
}

/**
 * Generate a new keypair, persist to disk, and return a signed credential.
 * Wraps the manager init path — use `persistKeypair` for bare keypair generation.
 */
export async function persistAuth(
  keysDir: string = KEYS_DIR,
  opts?: AuthOptions,
): Promise<AuthBinding> {
  const issuer = opts?.issuer ?? DEFAULT_MANAGER_ISSUER
  const subject = opts?.subject ?? 'manager'
  const kid = opts?.kid ?? `${subject}-key`

  const { privateJwk, publicJwk } = await persistKeypair(subject, { keysDir, kid })
  const credential = await signIdentityCredential({
    privateJwk,
    kid,
    issuer,
    subject,
    audience: issuer,
  })

  return { credential, publicKey: { jwk: publicJwk } }
}

/**
 * Load existing keys from disk and sign a fresh credential.
 */
export async function loadAuth(
  keysDir: string = KEYS_DIR,
  opts?: AuthOptions,
): Promise<AuthBinding> {
  const issuer = opts?.issuer ?? DEFAULT_MANAGER_ISSUER
  const subject = opts?.subject ?? 'manager'

  const { privateJwk, publicJwk, kid } = await loadSigningMaterial(subject, keysDir)
  const credential = await signIdentityCredential({
    privateJwk,
    kid,
    issuer,
    subject,
    audience: issuer,
  })

  return { credential, publicKey: { jwk: publicJwk } }
}

/**
 * Load existing keys if present, otherwise generate and persist new ones.
 */
export async function resolveAuth(
  keysDir: string = KEYS_DIR,
  opts?: AuthOptions,
): Promise<AuthBinding> {
  const subject = opts?.subject ?? 'manager'
  const { privatePath } = keypairPaths(subject, keysDir)
  if (await fileExists(privatePath)) {
    return loadAuth(keysDir, opts)
  }
  return persistAuth(keysDir, opts)
}

/**
 * Sign a JWT as a specific subject using only that subject's keypair.
 */
export async function signAs(
  subject: string,
  keysDir: string = KEYS_DIR,
  opts?: { readonly issuer?: string; readonly audience?: string; readonly subject?: string },
): Promise<string> {
  const issuer = opts?.issuer ?? DEFAULT_MANAGER_ISSUER
  const audience = opts?.audience ?? issuer
  const { privateJwk, kid } = await loadSigningMaterial(subject, keysDir)

  return signIdentityCredential({
    privateJwk,
    kid,
    issuer,
    subject: opts?.subject ?? subject,
    audience,
  })
}
