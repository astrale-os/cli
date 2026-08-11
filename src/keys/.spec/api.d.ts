import type { JWK } from 'jose'

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

export function keypairPaths(subject: string, keysDir?: string): KeypairPaths

export function fileExists(path: string): Promise<boolean>

export function listIdentityKeys(keysDir?: string): Promise<string[]>

export function generateEd25519Jwk(
  kid: string,
): Promise<{ readonly privateJwk: JWK; readonly publicJwk: JWK }>

export function persistKeypair(
  subject: string,
  opts?: { readonly keysDir?: string; readonly kid?: string },
): Promise<{ readonly publicJwk: JWK; readonly privateJwk: JWK; readonly kid: string }>

export function removeKeypair(subject: string, keysDir?: string): Promise<void>

export function persistAuth(keysDir?: string, opts?: AuthOptions): Promise<AuthBinding>

export function loadAuth(keysDir?: string, opts?: AuthOptions): Promise<AuthBinding>

export function resolveAuth(keysDir?: string, opts?: AuthOptions): Promise<AuthBinding>

export function signAs(
  subject: string,
  keysDir?: string,
  opts?: {
    readonly issuer?: string
    readonly audience?: string
    readonly subject?: string
  },
): Promise<string>
