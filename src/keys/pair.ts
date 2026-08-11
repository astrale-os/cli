import { compactVerify, CompactSign, exportJWK, generateKeyPair, importJWK, type JWK } from 'jose'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { AstraleError } from '../errors'
import { atomicWrite, KEYS_DIR } from '../state/index'
import { inferAlg } from './algorithm'

const LEGACY_MANAGER_PRIVATE = 'manager.private.jwk'
const LEGACY_MANAGER_PUBLIC = 'manager.public.jwk'

export type KeypairPaths = {
  readonly privatePath: string
  readonly publicPath: string
}

export interface Keypair {
  readonly privateJwk: JWK
  readonly publicJwk: JWK
  readonly kid?: string
}

export interface KeypairInput {
  readonly privateJwk: unknown
  readonly publicJwk: unknown
}

/** Preserve manager filenames and confine every subject file to the selected key directory. */
export function keypairPaths(subject: string, keysDir: string = KEYS_DIR): KeypairPaths {
  if (
    subject.length === 0 ||
    subject.includes('\0') ||
    subject.includes('/') ||
    subject.includes('\\')
  ) {
    throw invalidKeySubject(subject)
  }
  const filenames =
    subject === 'manager'
      ? { private: LEGACY_MANAGER_PRIVATE, public: LEGACY_MANAGER_PUBLIC }
      : { private: `${subject}.private.jwk`, public: `${subject}.public.jwk` }

  return {
    privatePath: confinedKeyPath(keysDir, filenames.private, subject),
    publicPath: confinedKeyPath(keysDir, filenames.public, subject),
  }
}

function confinedKeyPath(keysDir: string, filename: string, subject: string): string {
  const path = join(keysDir, filename)
  if (dirname(resolve(path)) !== resolve(keysDir)) throw invalidKeySubject(subject)
  return path
}

function invalidKeySubject(subject: string): AstraleError {
  return new AstraleError(
    'INVALID_KEY_SUBJECT',
    `Identity subject ${JSON.stringify(subject)} cannot name a key file.`,
    'Use a non-empty subject without path separators.',
  )
}

function invalidKeypair(message: string): AstraleError {
  return new AstraleError('INVALID_KEYPAIR', message, 'Import a supported matching keypair.')
}

function acceptJwk(input: unknown, role: 'private' | 'public'): JWK {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalidKeypair(`The ${role} JWK must be an object.`)
  }
  const jwk = { ...input } as JWK
  if (jwk.kid !== undefined && (typeof jwk.kid !== 'string' || jwk.kid.length === 0)) {
    throw invalidKeypair(`The ${role} JWK kid must be a non-empty string when present.`)
  }
  return jwk
}

export async function acceptKeypair(input: KeypairInput): Promise<Keypair> {
  const privateJwk = acceptJwk(input.privateJwk, 'private')
  const publicJwk = acceptJwk(input.publicJwk, 'public')
  if (!Object.hasOwn(privateJwk, 'd')) {
    throw invalidKeypair('The private JWK does not contain private key material.')
  }
  if (Object.hasOwn(publicJwk, 'd')) {
    throw invalidKeypair('The public JWK must not contain private key material.')
  }

  const privateAlg = inferAlg(privateJwk as Record<string, unknown>)
  const publicAlg = inferAlg(publicJwk as Record<string, unknown>)
  if (privateAlg !== publicAlg) {
    throw invalidKeypair(
      `The private and public JWK algorithms differ (${privateAlg} versus ${publicAlg}).`,
    )
  }
  if (privateJwk.kid && publicJwk.kid && privateJwk.kid !== publicJwk.kid) {
    throw invalidKeypair('The private and public JWK key IDs differ.')
  }

  try {
    const [privateKey, publicKey] = await Promise.all([
      importJWK(privateJwk, privateAlg),
      importJWK(publicJwk, publicAlg),
    ])
    const proof = await new CompactSign(new TextEncoder().encode('astrale-keypair-proof'))
      .setProtectedHeader({ alg: privateAlg })
      .sign(privateKey)
    await compactVerify(proof, publicKey, { algorithms: [publicAlg] })
  } catch {
    throw invalidKeypair('The private and public JWKs do not form a valid matching pair.')
  }

  return { privateJwk, publicJwk, kid: privateJwk.kid ?? publicJwk.kid }
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

export async function persistKeypair(
  subject: string,
  opts?: { readonly keysDir?: string; readonly kid?: string },
): Promise<{ readonly publicJwk: JWK; readonly privateJwk: JWK; readonly kid: string }> {
  const keysDir = opts?.keysDir ?? KEYS_DIR
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const publicJwk = await exportJWK(publicKey)
  const privateJwk = await exportJWK(privateKey)
  const kid = opts?.kid ?? `${subject}-key-${randomUUID().slice(0, 8)}`
  publicJwk.kid = kid
  privateJwk.kid = kid
  publicJwk.alg = 'ES256'
  privateJwk.alg = 'ES256'

  await writeKeypair(subject, { privateJwk, publicJwk, kid }, keysDir)
  return { publicJwk, privateJwk, kid }
}

export async function readKeypair(subject: string, keysDir: string = KEYS_DIR): Promise<Keypair> {
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)
  try {
    const [privateRaw, publicRaw] = await Promise.all([
      readFile(privatePath, 'utf-8'),
      readFile(publicPath, 'utf-8'),
    ])
    return await acceptKeypair({
      privateJwk: JSON.parse(privateRaw) as unknown,
      publicJwk: JSON.parse(publicRaw) as unknown,
    })
  } catch (error) {
    if (error instanceof AstraleError) throw error
    throw invalidKeypair(`Could not read the keypair for identity ${JSON.stringify(subject)}.`)
  }
}

export async function importKeypair(
  subject: string,
  input: KeypairInput,
  keysDir: string = KEYS_DIR,
): Promise<Keypair> {
  const pair = await acceptKeypair(input)
  await writeKeypair(subject, pair, keysDir)
  return pair
}

async function writeKeypair(subject: string, pair: Keypair, keysDir: string): Promise<void> {
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)
  await mkdir(keysDir, { recursive: true })
  await atomicWrite(privatePath, JSON.stringify(pair.privateJwk, null, 2))
  await atomicWrite(publicPath, JSON.stringify(pair.publicJwk, null, 2))
}

export async function removeKeypair(subject: string, keysDir: string = KEYS_DIR): Promise<void> {
  const { privatePath, publicPath } = keypairPaths(subject, keysDir)
  for (const path of [privatePath, publicPath]) {
    try {
      await unlink(path)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }
}
