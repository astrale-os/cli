import type { AuthBinding } from '@astrale-os/kernel-toolkit/presets'

import { generateKeyPair, exportJWK, importJWK, SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises'
import { join } from 'node:path'

import { KEYS_DIR } from './paths'

const PRIVATE_KEY_FILE = 'manager.private.jwk'
const PUBLIC_KEY_FILE = 'manager.public.jwk'

type AuthOptions = {
  issuer?: string
  subject?: string
  kid?: string
}

/**
 * Generate a new keypair, persist to disk, and return a signed credential.
 */
export async function persistAuth(
  keysDir: string = KEYS_DIR,
  opts?: AuthOptions,
): Promise<AuthBinding> {
  const issuer = opts?.issuer ?? 'http://localhost:4400/mngt'
  const subject = opts?.subject ?? 'manager'
  const kid = opts?.kid ?? `${subject}-key`

  await mkdir(keysDir, { recursive: true })

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const privateJwk = await exportJWK(privateKey)
  publicJwk.kid = kid
  privateJwk.kid = kid

  // Atomic writes via tmp + rename
  await atomicWrite(join(keysDir, PRIVATE_KEY_FILE), JSON.stringify(privateJwk, null, 2))
  await atomicWrite(join(keysDir, PUBLIC_KEY_FILE), JSON.stringify(publicJwk, null, 2))

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

  const privateJwk = JSON.parse(await readFile(join(keysDir, PRIVATE_KEY_FILE), 'utf-8'))
  const publicJwk = JSON.parse(await readFile(join(keysDir, PUBLIC_KEY_FILE), 'utf-8'))
  const kid = privateJwk.kid ?? `${subject}-key`

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
  if (await keysExist(keysDir)) {
    return loadAuth(keysDir, opts)
  }
  return persistAuth(keysDir, opts)
}

/**
 * Sign a JWT as a specific subject using the existing keypair.
 */
export async function signAs(
  subject: string,
  keysDir: string = KEYS_DIR,
  opts?: { issuer?: string },
): Promise<string> {
  const issuer = opts?.issuer ?? 'http://localhost:4400/mngt'
  const privateJwk = JSON.parse(await readFile(join(keysDir, PRIVATE_KEY_FILE), 'utf-8'))
  const kid = privateJwk.kid ?? `${subject}-key`
  const privateKey = await importJWK(privateJwk, 'ES256')

  return new SignJWT({ grant: { v: 1, expr: { kind: 'identity', self: true } } })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience(issuer)
    .sign(privateKey)
}

async function keysExist(keysDir: string): Promise<boolean> {
  try {
    await access(join(keysDir, PRIVATE_KEY_FILE))
    await access(join(keysDir, PUBLIC_KEY_FILE))
    return true
  } catch {
    return false
  }
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, path)
}
