/**
 * Cryptographic Key Utilities
 *
 * Generates and manages ECDSA P-256 keypairs for app identity.
 */

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const

export interface AppKeyPair {
  /** Public key in JWK format (stored in kernel) */
  publicKeyJwk: JsonWebKey
  /** Private key in PEM format (stored locally) */
  privateKeyPem: string
}

/**
 * Generate a new ECDSA P-256 keypair for app identity.
 */
export async function generateAppKeyPair(): Promise<AppKeyPair> {
  const keyPair = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
  const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
  const privateKeyPem = arrayBufferToPem(privateKeyPkcs8, "PRIVATE KEY")

  return {
    publicKeyJwk,
    privateKeyPem,
  }
}

/**
 * Convert ArrayBuffer to PEM format.
 */
function arrayBufferToPem(buffer: ArrayBuffer, label: string): string {
  const base64 = Buffer.from(buffer).toString("base64")
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`
}

/**
 * Import a PEM-encoded private key.
 */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "")

  const binaryKey = Buffer.from(pemContents, "base64")

  return crypto.subtle.importKey("pkcs8", binaryKey, ALGORITHM, false, ["sign"])
}
