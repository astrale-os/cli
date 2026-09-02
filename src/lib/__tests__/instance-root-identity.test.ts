import { describe, expect, mock, test } from 'bun:test'

import type { IdentityExport, RootIdentityRecipientContext } from '../../identity'

import { IssuerUnreachableError } from '../../errors'
import { importInstanceRootIdentity } from '../instance-root-identity'

const recipient = {
  recipient: {
    kty: 'EC',
    crv: 'P-256',
    x: 'x'.repeat(43),
    y: 'y'.repeat(43),
    kid: 'r'.repeat(43),
  },
  privateKey: {} as CryptoKey,
} satisfies RootIdentityRecipientContext

const instance = {
  id: '@admin-instance',
  slug: 'demo',
  url: 'https://demo.example.test/api',
  issuer: 'https://demo.example.test/api',
  state: 'ready',
} as const

const transfer = {
  format: 'astrale.instance-root-transfer',
  version: 1,
  requestId: 'request-1',
  instance: instance.id,
  issuer: instance.issuer,
  subject: 's'.repeat(43),
  recipientThumbprint: recipient.recipient.kid,
  jwe: 'a.b.c.d.e',
} as const

const envelope = {
  version: 1,
  subject: transfer.subject,
  mode: 'local',
  kid: 'kernel-key',
  issuer: instance.issuer,
  privateJwk: { kty: 'EC', d: 'private' },
  publicJwk: { kty: 'EC', x: 'public' },
} satisfies IdentityExport

describe('Instance root identity import', () => {
  test('installs the canonical identity, verifies live publication, and preserves owner bookmark auth', async () => {
    const importIdentity = mock(async () => ({
      subject: envelope.subject,
      createdAt: '2026-09-02T00:00:00.000Z',
      source: 'key' as const,
      mode: 'local' as const,
      issuer: envelope.issuer,
    }))
    const bookmark = mock(async () => ({ entry: { url: instance.url } }))
    const clearCaches = mock(async () => {})

    const result = await importInstanceRootIdentity(
      {},
      'demo',
      {},
      {
        createRecipient: async () => recipient,
        retrieve: async () => ({ instance, transfer, ownerIdentity: 'workos-owner' }),
        decode: async (_transfer, _recipient, scope) => {
          expect(scope).toEqual({
            instance: instance.id,
            issuer: instance.issuer,
            requestId: transfer.requestId,
            recipientThumbprint: recipient.recipient.kid,
            subject: transfer.subject,
          })
          return envelope
        },
        readIdentities: async () => ({
          default: 'workos-owner',
          identities: { 'demo-root': { subject: 'stale', createdAt: 'yesterday' } },
        }),
        importIdentity,
        checkIssuer: async () => ({ issuer: instance.issuer, keys: [envelope.publicJwk] }),
        thumbprint: async () => envelope.subject,
        bookmark,
        clearCaches,
      },
    )

    expect(result).toMatchObject({
      name: 'demo-root',
      replaced: true,
      verification: 'live-jwks',
    })
    expect(importIdentity).toHaveBeenCalledWith(envelope, {
      name: 'demo-root',
      issuer: instance.issuer,
      replace: true,
    })
    expect(clearCaches).toHaveBeenCalledTimes(1)
    expect(bookmark).toHaveBeenCalledWith({
      key: 'demo',
      slug: 'demo',
      url: instance.url,
      defaultIdentity: 'workos-owner',
      activateWhenEmpty: false,
    })
  })

  test('falls back to the authenticated Host transfer while a ready issuer is offline', async () => {
    const result = await importInstanceRootIdentity(
      {},
      'demo',
      { bookmark: false },
      {
        createRecipient: async () => recipient,
        retrieve: async () => ({ instance, transfer }),
        decode: async () => envelope,
        readIdentities: async () => ({ default: '', identities: {} }),
        importIdentity: async () => ({
          subject: envelope.subject,
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
        checkIssuer: async () => {
          throw new IssuerUnreachableError(instance.issuer)
        },
        clearCaches: async () => {},
      },
    )

    expect(result.verification).toBe('host-sealed')
  })
})
