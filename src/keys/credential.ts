import { importJWK, SignJWT, type JWK } from 'jose'

import { IdentityKeyMissingError } from '../errors'
import { KEYS_DIR } from '../state/index'
import { inferAlg } from './algorithm'
import { fileExists, keypairPaths, persistKeypair, readKeypair } from './pair'

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

async function loadSigningMaterial(
  subject: string,
  keysDir: string,
): Promise<{ privateJwk: JWK; publicJwk: JWK; kid: string }> {
  const { privatePath } = keypairPaths(subject, keysDir)
  if (!(await fileExists(privatePath))) throw new IdentityKeyMissingError(subject)

  const pair = await readKeypair(subject, keysDir)
  return { ...pair, kid: pair.kid ?? `${subject}-key` }
}

async function signIdentityCredential(options: {
  readonly privateJwk: JWK
  readonly kid: string
  readonly issuer: string
  readonly subject: string
  readonly audience: string
}): Promise<string> {
  const alg = inferAlg(options.privateJwk as Record<string, unknown>)
  const privateKey = await importJWK(options.privateJwk, alg)
  const expr =
    options.issuer === options.audience
      ? { kind: 'identity' as const, id: options.subject }
      : { kind: 'identity' as const, self: true as const }
  return new SignJWT({ grant: { v: 1, expr } })
    .setProtectedHeader({ alg, kid: options.kid })
    .setIssuer(options.issuer)
    .setSubject(options.subject)
    .setAudience(options.audience)
    .setExpirationTime('5m')
    .sign(privateKey)
}

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

export async function resolveAuth(
  keysDir: string = KEYS_DIR,
  opts?: AuthOptions,
): Promise<AuthBinding> {
  const subject = opts?.subject ?? 'manager'
  const { privatePath } = keypairPaths(subject, keysDir)
  return (await fileExists(privatePath)) ? loadAuth(keysDir, opts) : persistAuth(keysDir, opts)
}

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
