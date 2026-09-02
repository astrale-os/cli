import {
  calculateJwkThumbprint,
  compactDecrypt,
  exportJWK,
  generateKeyPair,
  type JWK,
  type ProtectedHeaderParameters,
} from 'jose'

import type { RootIdentityRecipient, RootIdentityTransfer } from '../admin/instance'

import { AstraleError } from '../errors'
import { decodeIdentityExport, type IdentityExport } from './transfer'

const TRANSFER_TYPE = 'astrale.instance-root-transfer+jwe'
const CONTENT_TYPE = 'astrale.identity-export+json'
const P256_MEMBER = /^[A-Za-z0-9_-]{43}$/u

export interface RootIdentityRecipientContext {
  readonly recipient: RootIdentityRecipient
  readonly privateKey: CryptoKey
}

export interface RootIdentityTransferScope {
  readonly instance: string
  readonly issuer: string
  readonly requestId: string
  readonly recipientThumbprint: string
  readonly subject: string
}

/** Create a one-use public recipient; its private half never leaves this process. */
export async function createRootIdentityRecipient(): Promise<RootIdentityRecipientContext> {
  const pair = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true })
  const exported = await exportJWK(pair.publicKey)
  const publicJwk = publicP256Jwk(exported)
  const kid = await calculateJwkThumbprint(publicJwk, 'sha256')
  return Object.freeze({
    recipient: Object.freeze({ ...publicJwk, kid }),
    privateKey: pair.privateKey,
  })
}

/** Decrypt and bind a Host-sealed export to the exact Admin request and Instance. */
export async function decodeRootIdentityTransfer(
  transfer: RootIdentityTransfer,
  recipient: RootIdentityRecipientContext,
  scope: RootIdentityTransferScope,
): Promise<IdentityExport> {
  assertOuterScope(transfer, recipient, scope)

  let plaintext: Uint8Array
  let header: ProtectedHeaderParameters
  try {
    const decrypted = await compactDecrypt(transfer.jwe, recipient.privateKey, {
      keyManagementAlgorithms: ['ECDH-ES+A256KW'],
      contentEncryptionAlgorithms: ['A256GCM'],
    })
    plaintext = decrypted.plaintext
    header = decrypted.protectedHeader
  } catch {
    throw invalidTransfer('Could not decrypt the Instance root identity transfer.')
  }
  assertProtectedHeader(header, scope)

  let envelope: IdentityExport
  try {
    envelope = await decodeIdentityExport(new TextDecoder().decode(plaintext))
  } catch {
    throw invalidTransfer('The Instance root identity export is invalid.')
  }
  if (
    envelope.mode !== 'local' ||
    envelope.subject !== scope.subject ||
    envelope.issuer !== scope.issuer
  ) {
    throw invalidTransfer('The Instance root identity export does not match its transfer scope.')
  }
  const subject = await calculateJwkThumbprint(envelope.publicJwk, 'sha256').catch(() => '')
  if (subject !== scope.subject) {
    throw invalidTransfer('The Instance root identity subject does not match its public key.')
  }
  return envelope
}

function assertOuterScope(
  transfer: RootIdentityTransfer,
  recipient: RootIdentityRecipientContext,
  scope: RootIdentityTransferScope,
): void {
  if (
    transfer.format !== 'astrale.instance-root-transfer' ||
    transfer.version !== 1 ||
    transfer.instance !== scope.instance ||
    transfer.issuer !== scope.issuer ||
    transfer.requestId !== scope.requestId ||
    transfer.subject !== scope.subject ||
    transfer.recipientThumbprint !== scope.recipientThumbprint ||
    transfer.recipientThumbprint !== recipient.recipient.kid
  ) {
    throw invalidTransfer('The Instance root identity transfer does not match its request.')
  }
}

function assertProtectedHeader(
  header: ProtectedHeaderParameters,
  scope: RootIdentityTransferScope,
): void {
  const value = header as Readonly<Record<string, unknown>>
  const fields = [
    'alg',
    'binding',
    'cty',
    'enc',
    'epk',
    'instance',
    'issuer',
    'kid',
    'requestId',
    'typ',
    'version',
  ]
  const keys = Object.keys(value).sort()
  if (
    keys.length !== fields.length ||
    !keys.every((key, index) => key === fields[index]) ||
    value.alg !== 'ECDH-ES+A256KW' ||
    value.enc !== 'A256GCM' ||
    value.typ !== TRANSFER_TYPE ||
    value.cty !== CONTENT_TYPE ||
    value.version !== 1 ||
    value.requestId !== scope.requestId ||
    value.binding !== scope.instance ||
    value.issuer !== scope.issuer ||
    value.kid !== scope.recipientThumbprint ||
    typeof value.instance !== 'string' ||
    !/^@[A-Za-z0-9_-]+$/u.test(value.instance)
  ) {
    throw invalidTransfer('The Instance root identity transfer header is invalid.')
  }
}

function publicP256Jwk(input: JWK): Omit<RootIdentityRecipient, 'kid'> {
  if (
    input.kty !== 'EC' ||
    input.crv !== 'P-256' ||
    typeof input.x !== 'string' ||
    !P256_MEMBER.test(input.x) ||
    typeof input.y !== 'string' ||
    !P256_MEMBER.test(input.y)
  ) {
    throw invalidTransfer('Could not create an ephemeral P-256 recipient.')
  }
  return Object.freeze({ kty: 'EC', crv: 'P-256', x: input.x, y: input.y })
}

function invalidTransfer(message: string): AstraleError {
  return new AstraleError('INVALID_ROOT_IDENTITY_TRANSFER', message)
}
