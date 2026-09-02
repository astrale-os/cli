import { describe, expect, test } from 'bun:test'
import { calculateJwkThumbprint, CompactEncrypt, exportJWK, generateKeyPair, importJWK } from 'jose'

import type { RootIdentityTransfer } from '../../admin/instance'

import { createRootIdentityRecipient, decodeRootIdentityTransfer } from '../root-transfer'

describe('Instance root identity transfer', () => {
  test('decrypts a Host-sealed exact identity export bound to its Admin request', async () => {
    const recipient = await createRootIdentityRecipient()
    const signing = await generateKeyPair('ES256', { extractable: true })
    const privateJwk = await exportJWK(signing.privateKey)
    const publicJwk = await exportJWK(signing.publicKey)
    publicJwk.kid = privateJwk.kid = 'kernel-signing-key'
    const subject = await calculateJwkThumbprint(publicJwk, 'sha256')
    const scope = {
      instance: '@admin-instance',
      issuer: 'https://demo.example.test/api',
      requestId: 'request-1',
      recipientThumbprint: recipient.recipient.kid,
      subject,
    }
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        subject,
        mode: 'local',
        kid: publicJwk.kid,
        issuer: scope.issuer,
        privateJwk,
        publicJwk,
      }),
    )
    const jwe = await new CompactEncrypt(plaintext)
      .setProtectedHeader({
        alg: 'ECDH-ES+A256KW',
        enc: 'A256GCM',
        typ: 'astrale.instance-root-transfer+jwe',
        cty: 'astrale.identity-export+json',
        version: 1,
        requestId: scope.requestId,
        instance: '@host-instance',
        binding: scope.instance,
        issuer: scope.issuer,
        kid: recipient.recipient.kid,
      })
      .encrypt(await importJWK(recipient.recipient, 'ECDH-ES+A256KW'))
    const transfer: RootIdentityTransfer = {
      format: 'astrale.instance-root-transfer',
      version: 1,
      requestId: scope.requestId,
      instance: scope.instance,
      issuer: scope.issuer,
      subject,
      recipientThumbprint: recipient.recipient.kid,
      jwe,
    }

    await expect(decodeRootIdentityTransfer(transfer, recipient, scope)).resolves.toMatchObject({
      subject,
      mode: 'local',
      issuer: scope.issuer,
      privateJwk: { d: expect.any(String) },
      publicJwk: { x: expect.any(String), y: expect.any(String) },
    })
    await expect(
      decodeRootIdentityTransfer(
        { ...transfer, instance: '@other-admin-instance' },
        recipient,
        scope,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ROOT_IDENTITY_TRANSFER' })
  })
})
