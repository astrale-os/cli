import type { JWK } from 'jose'

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

/** Admit supported private/public JWKs and prove that they form one pair. */
export function acceptKeypair(input: KeypairInput): Promise<Keypair>

/** Decode and cryptographically prove a persisted subject keypair. */
export function readKeypair(subject: string, keysDir?: string): Promise<Keypair>

/** Admit and atomically persist one externally supplied subject keypair. */
export function importKeypair(
  subject: string,
  input: KeypairInput,
  keysDir?: string,
): Promise<Keypair>

export function removeKeypair(subject: string, keysDir?: string): Promise<void>

export function signAs(
  subject: string,
  keysDir: string | undefined,
  opts: {
    readonly issuer: string
    readonly audience?: string
    readonly subject?: string
  },
): Promise<string>
