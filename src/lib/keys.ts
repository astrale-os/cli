import type { AuthBinding } from '@astrale-os/kernel-toolkit/presets'

import { generateKeyPair, exportJWK, importJWK, SignJWT, type JWK } from 'jose'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, access, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { IdentityKeyMissingError } from '../errors'
import { log } from './log'
import { KEYS_DIR } from './paths'

const LEGACY_MANAGER_PRIVATE = 'manager.private.jwk'
const LEGACY_MANAGER_PUBLIC = 'manager.public.jwk'

type AuthOptions = {
  issuer?: string
  subject?: string
  kid?: string
}

export type KeypairPaths = {
  privatePath: string
  publicPath: string
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
  } catch {
    return false
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
  } catch {
    return []
  }
}

/**
 * Generate a new keypair for `subject`, persist atomically with 0o600
 * perms, and return the JWKs + kid. Overwrites any existing keys.
 */
export async function persistKeypair(
  subject: string,
  opts?: { keysDir?: string; kid?: string },
): Promise<{ publicJwk: JWK; privateJwk: JWK; kid: string }> {
  const keysDir = opts?.keysDir ?? KEYS_DIR
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)
  await mkdir(keysDir, { recursive: true })

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const privateJwk = await exportJWK(privateKey)
  const kid = opts?.kid ?? `${subject}-key-${randomUUID().slice(0, 8)}`
  publicJwk.kid = kid
  privateJwk.kid = kid

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
    } catch {
      /* ignore */
    }
  }
}

// Legacy signal: warn once per session when an unknown subject falls back
// to the manager key.
const warnedFallback = new Set<string>()

async function loadSigningMaterial(
  subject: string,
  keysDir: string,
): Promise<{ privateJwk: JWK; publicJwk: JWK; kid: string; fromFallback: boolean }> {
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)

  if (await fileExists(privatePath)) {
    const privateJwk = JSON.parse(await readFile(privatePath, 'utf-8')) as JWK
    const publicJwk = JSON.parse(await readFile(publicPath, 'utf-8')) as JWK
    return {
      privateJwk,
      publicJwk,
      kid: (privateJwk.kid as string | undefined) ?? `${subject}-key`,
      fromFallback: false,
    }
  }

  if (process.env.ASTRALE_STRICT_IDENTITIES === '1') {
    throw new IdentityKeyMissingError(subject)
  }

  // Manager always uses its own file. Any other subject falls through
  // to the manager key with a one-shot warning so the migration window
  // stays visible without being noisy.
  if (subject === 'manager') throw new IdentityKeyMissingError(subject)

  const { privatePath: mgrPrivate, publicPath: mgrPublic } = keypairPaths('manager', keysDir)
  if (!(await fileExists(mgrPrivate))) throw new IdentityKeyMissingError(subject)

  if (!warnedFallback.has(subject)) {
    log.warn(
      `Legacy shared-key mode for "${subject}" — run \`astrale identity create ${subject}\` to generate a dedicated key.`,
    )
    warnedFallback.add(subject)
  }
  const privateJwk = JSON.parse(await readFile(mgrPrivate, 'utf-8')) as JWK
  const publicJwk = JSON.parse(await readFile(mgrPublic, 'utf-8')) as JWK
  return {
    privateJwk,
    publicJwk,
    kid: (privateJwk.kid as string | undefined) ?? 'manager-key',
    fromFallback: true,
  }
}

/**
 * Generate a new keypair, persist to disk, and return a signed credential.
 * Wraps the manager init path — use `persistKeypair` for bare keypair generation.
 */
export async function persistAuth(
  keysDir: string = KEYS_DIR,
  opts?: AuthOptions,
): Promise<AuthBinding> {
  const issuer = opts?.issuer ?? 'http://localhost:4400/mngt'
  const subject = opts?.subject ?? 'manager'
  const kid = opts?.kid ?? `${subject}-key`

  const { privateJwk, publicJwk } = await persistKeypair(subject, { keysDir, kid })
  const privateKey = await importJWK(privateJwk, 'ES256')

  const credential = await new SignJWT({
    grant: { v: 1, expr: { kind: 'identity', self: true } },
  })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(issuer)
    .sign(privateKey)

  return { credential, publicKey: { jwk: publicJwk } }
}

/**
 * Load existing keys from disk and sign a fresh credential.
 */
export async function loadAuth(
  keysDir: string = KEYS_DIR,
  opts?: AuthOptions,
): Promise<AuthBinding> {
  const issuer = opts?.issuer ?? 'http://localhost:4400/mngt'
  const subject = opts?.subject ?? 'manager'

  const { privateJwk, publicJwk, kid } = await loadSigningMaterial(subject, keysDir)
  const privateKey = await importJWK(privateJwk, 'ES256')

  const credential = await new SignJWT({
    grant: { v: 1, expr: { kind: 'identity', self: true } },
  })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(issuer)
    .sign(privateKey)

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
 * Sign a JWT as a specific subject. Uses the subject's own keypair when
 * present; falls back to the manager key (with a one-shot warning) for
 * unknown subjects until `ASTRALE_STRICT_IDENTITIES=1` is set.
 */
export async function signAs(
  subject: string,
  keysDir: string = KEYS_DIR,
  opts?: { issuer?: string; audience?: string },
): Promise<string> {
  const issuer = opts?.issuer ?? 'http://localhost:4400/mngt'
  const audience = opts?.audience ?? issuer
  const { privateJwk, kid } = await loadSigningMaterial(subject, keysDir)
  const privateKey = await importJWK(privateJwk, 'ES256')

  return new SignJWT({ grant: { v: 1, expr: { kind: 'identity', self: true } } })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(audience)
    .sign(privateKey)
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, path)
}
