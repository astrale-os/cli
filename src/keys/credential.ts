import { importJWK, SignJWT, type JWK } from 'jose'

import { IdentityKeyMissingError } from '../errors'
import { KEYS_DIR } from '../state/index'
import { inferAlg } from './algorithm'
import { fileExists, keypairPaths, readKeypair } from './pair'

const IDENTITY_CREDENTIAL_TTL_SECONDS = 60 * 60

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
    .setExpirationTime(`${IDENTITY_CREDENTIAL_TTL_SECONDS}s`)
    .sign(privateKey)
}

export async function signAs(
  subject: string,
  keysDir: string = KEYS_DIR,
  opts: { readonly issuer: string; readonly audience?: string; readonly subject?: string },
): Promise<string> {
  const issuer = opts.issuer
  if (!issuer) throw new TypeError('Signing an identity credential requires its issuer.')
  const audience = opts.audience ?? issuer
  const { privateJwk, kid } = await loadSigningMaterial(subject, keysDir)
  return signIdentityCredential({
    privateJwk,
    kid,
    issuer,
    subject: opts.subject ?? subject,
    audience,
  })
}
