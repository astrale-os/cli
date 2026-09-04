import { describe, expect, mock, test } from 'bun:test'
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose'

import type { ConnectionContext } from '../../connection'
import type { IdentityExport } from '../../identity'
import type { HostInstance } from '../instance'

import { connectHostChild } from '../root'

const child: HostInstance = {
  instance: '@child',
  slug: 'development',
  issuer: 'https://kernel.test/kernel/development',
  desired: { state: 'running', generation: 1 },
  observed: { state: 'ready', generation: 1 },
  route: { state: 'published', url: 'https://kernel.test/kernel/development' },
}

async function fixture(binding = '@child') {
  const keys = await generateKeyPair('EdDSA', { extractable: true })
  const publicJwk = await exportJWK(keys.publicKey)
  const subject = await calculateJwkThumbprint(publicJwk)
  const envelope: IdentityExport = {
    version: 1,
    subject,
    mode: 'local',
    issuer: child.issuer,
    publicJwk,
    privateJwk: await exportJWK(keys.privateKey),
  }
  const dispatch = mock(async () => ({
    kind: 'value',
    value: {
      format: 'astrale.instance-root-transfer',
      version: 1,
      requestId: 'request',
      instance: '@child',
      binding,
      issuer: child.issuer,
      subject,
      recipientThumbprint: 'recipient',
      jwe: 'sealed-transfer',
    },
  }))
  const context = {
    session: { dispatch },
    target: { caFile: '/private/kernel-ca.pem' },
  } as unknown as ConnectionContext
  const dependencies = {
    readInstances: mock(async () => ({ active: 'unrelated', instances: {} })),
    readIdentities: mock(async () => ({ default: 'unrelated', identities: {} })),
    decodeRootIdentityTransfer: mock(async () => envelope),
    checkIssuerReachability: mock(async () => ({ issuer: child.issuer, keys: [publicJwk] })),
    importIdentity: mock(async () => ({ subject, createdAt: 'today' })),
    upsertInstance: mock(async () => ({ entry: { url: child.issuer }, created: true })),
    clearCaches: mock(async () => {}),
    fetchWithCaFile: mock(() => globalThis.fetch),
  }
  return { context, dependencies, dispatch, envelope }
}

describe('Kernel Host root connection', () => {
  test('verifies live publication before storing a root and Host-qualified bookmark', async () => {
    const { context, dependencies, envelope } = await fixture()
    const result = await connectHostChild(context, 'kernel-a', child, dependencies)
    expect(result).toMatchObject({
      bookmark: 'kernel-a-development',
      identity: 'kernel-a-development-root',
      subject: envelope.subject,
      verification: 'live-jwks',
    })
    expect(dependencies.importIdentity).toHaveBeenCalledWith(envelope, {
      name: 'kernel-a-development-root',
      issuer: child.issuer,
      replace: false,
    })
    expect(dependencies.upsertInstance).toHaveBeenCalledWith(
      'kernel-a-development',
      expect.objectContaining({
        issuer: child.issuer,
        caFile: '/private/kernel-ca.pem',
        defaultIdentity: 'kernel-a-development-root',
      }),
      { activateWhenEmpty: false, requireSameTarget: true },
    )
    expect(dependencies.decodeRootIdentityTransfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        instance: '@child',
        issuer: child.issuer,
        requestId: expect.any(String),
      }),
    )
    expect(dependencies.clearCaches).toHaveBeenCalledTimes(1)
    expect(dependencies.fetchWithCaFile).toHaveBeenCalledWith('/private/kernel-ca.pem')
  })

  test('rejects a different child binding before decoding or local mutation', async () => {
    const { context, dependencies } = await fixture('@other')
    await expect(connectHostChild(context, 'kernel-a', child, dependencies)).rejects.toMatchObject({
      code: 'HOST_TRANSFER_INVALID',
    })
    expect(dependencies.decodeRootIdentityTransfer).not.toHaveBeenCalled()
    expect(dependencies.importIdentity).not.toHaveBeenCalled()
    expect(dependencies.upsertInstance).not.toHaveBeenCalled()
  })

  test('rejects a root absent from the live child JWKS without writing', async () => {
    const { context, dependencies } = await fixture()
    await expect(
      connectHostChild(context, 'kernel-a', child, {
        ...dependencies,
        checkIssuerReachability: async () => ({ issuer: child.issuer, keys: [] }),
      }),
    ).rejects.toMatchObject({ code: 'HOST_ROOT_MISMATCH' })
    expect(dependencies.importIdentity).not.toHaveBeenCalled()
    expect(dependencies.upsertInstance).not.toHaveBeenCalled()
  })

  test('protects a bookmark belonging to a different Kernel before exporting private material', async () => {
    const { context, dependencies, dispatch } = await fixture()
    await expect(
      connectHostChild(context, 'kernel-a', child, {
        ...dependencies,
        readInstances: async () => ({
          active: 'unrelated',
          instances: { 'kernel-a-development': { url: 'https://other.test' } },
        }),
      }),
    ).rejects.toMatchObject({ code: 'HOST_BOOKMARK_CONFLICT' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(dependencies.importIdentity).not.toHaveBeenCalled()
  })

  test('protects an IdP-backed identity before exporting private material', async () => {
    const { context, dependencies, dispatch } = await fixture()
    await expect(
      connectHostChild(context, 'kernel-a', child, {
        ...dependencies,
        readIdentities: async () => ({
          default: '',
          identities: {
            'kernel-a-development-root': {
              subject: 'human',
              createdAt: 'today',
              source: 'idp',
              issuer: child.issuer,
            },
          },
        }),
      }),
    ).rejects.toMatchObject({ code: 'HOST_IDENTITY_CONFLICT' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(dependencies.importIdentity).not.toHaveBeenCalled()
  })
})
