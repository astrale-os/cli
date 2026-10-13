import { credential } from '@astrale-os/sdk/auth'
import { K } from '@astrale-os/sdk/schema'
import { describe, expect, setSystemTime, test } from 'bun:test'

import { runsOnKernelCredential } from '../view/grant'
import { createOwnerAccess, identityLabel, listIdentities } from '../view/owner'
import {
  DOMAIN_VIEW,
  instanceKernel,
  KERNEL,
  KERNEL_VIEW,
  node,
  OWNER,
  seconds,
  SHELL_VIEW,
} from './view-owner.fixture'
import { mintedCredential } from './view.fixture'

describe('owner-mode View authority', () => {
  test('a View the Kernel issues, or a Shell View, runs on a Kernel credential; any other is exchanged', () => {
    expect(runsOnKernelCredential(KERNEL_VIEW, KERNEL)).toBe(true)
    expect(runsOnKernelCredential(SHELL_VIEW, KERNEL)).toBe(true)
    expect(runsOnKernelCredential(DOMAIN_VIEW, KERNEL)).toBe(false)
  })

  test('runs as root by default: one Admin round trip, every grant derived from root', async () => {
    const kernel = instanceKernel()
    const access = createOwnerAccess(OWNER, { url: KERNEL, issuer: KERNEL }, kernel)
    const grants = await Promise.all([
      access.grant(undefined, DOMAIN_VIEW),
      access.grant(undefined, KERNEL_VIEW),
      access.grant(undefined, SHELL_VIEW),
      access.grant(undefined),
    ])
    expect(grants.map(({ kind }) => kind)).toEqual(['exchanged', 'minted', 'minted', 'minted'])
    expect(grants[0]!.token).toBe('exchanged:root@https://issues.example')
    expect(credential.inspect(grants[1]!.token).sub).toBe('grant:root')
    expect(kernel.rootToken).toHaveBeenCalledTimes(1)
    expect(kernel.rootToken).toHaveBeenCalledWith(OWNER)
    expect(kernel.impersonate).not.toHaveBeenCalled()
    access.close()
  })

  test('runs as an Identity through one impersonation minted by root, its subject checked', async () => {
    const kernel = instanceKernel()
    const access = createOwnerAccess(OWNER, { url: KERNEL, issuer: KERNEL }, kernel)
    expect((await access.grant('alice', DOMAIN_VIEW)).token).toBe(
      'exchanged:alice@https://issues.example',
    )
    expect(credential.inspect((await access.grant('alice', KERNEL_VIEW)).token).sub).toBe(
      'grant:alice',
    )
    expect(kernel.impersonate).toHaveBeenCalledTimes(1)
    expect(kernel.impersonate.mock.calls[0]![0]).toEqual({ identity: 'alice', ttlSeconds: 180 })

    // Another Identity replaces the impersonation held so far.
    expect((await access.grant('bob', DOMAIN_VIEW)).token).toBe(
      'exchanged:bob@https://issues.example',
    )
    expect(kernel.closed).toEqual(['1'])
    access.close()

    const forged = instanceKernel({ impersonatedSubject: () => 'mallory' })
    const refusing = createOwnerAccess(OWNER, { url: KERNEL, issuer: KERNEL }, forged)
    await expect(refusing.grant('alice', DOMAIN_VIEW)).rejects.toThrow('subject does not match')
    refusing.close()
  })

  test('refuses root issued for another Kernel, and fails closed once Admin stops issuing it', async () => {
    const elsewhere = instanceKernel({
      rootToken: async () => ({
        token: mintedCredential('root', seconds(300)),
        issuer: 'https://another.test',
        expiresAt: seconds(300),
      }),
    })
    const access = createOwnerAccess(OWNER, { url: KERNEL, issuer: KERNEL }, elsewhere)
    await expect(access.grant(undefined, KERNEL_VIEW)).rejects.toMatchObject({
      code: 'VIEW_OWNER_TARGET_CHANGED',
    })
    access.close()

    // A root that no longer covers an impersonation is renewed on the next grant, and a revoked
    // ownership makes that renewal - and so the grant - fail. Nothing is served past it.
    let owner = true
    const revoked = instanceKernel({
      rootToken: async () => {
        if (!owner) throw new Error('Permission denied.')
        return {
          token: mintedCredential('root', seconds(300)),
          issuer: KERNEL,
          expiresAt: seconds(300),
        }
      },
    })
    const revoking = createOwnerAccess(OWNER, { url: KERNEL, issuer: KERNEL }, revoked)
    await revoking.grant(undefined, KERNEL_VIEW)
    await revoking.grant('alice', KERNEL_VIEW)
    expect(revoked.rootToken).toHaveBeenCalledTimes(1)
    owner = false
    // Two minutes on, root no longer covers an impersonation and must come from Admin again.
    setSystemTime(new Date(Date.now() + 120_000))
    try {
      await expect(revoking.grant(undefined, KERNEL_VIEW)).rejects.toThrow('Permission denied.')
      await expect(revoking.grant('bob', KERNEL_VIEW)).rejects.toThrow('Permission denied.')
    } finally {
      setSystemTime()
    }
    expect(revoked.rootToken).toHaveBeenCalledTimes(3)
    revoking.close()
  })

  test('lists Root, then Users, then other Identities with their class, all read as root', async () => {
    const kernel = instanceKernel()
    const access = createOwnerAccess(OWNER, { url: KERNEL, issuer: KERNEL }, kernel)
    expect(await access.identities()).toEqual([
      { id: null, label: 'Root', kind: 'root' },
      { id: 'alice', label: 'alice@x.test', kind: 'user' },
      { id: 'bob', label: 'bob@x.test', kind: 'user' },
      { id: 'agent', label: 'Support agent', kind: 'identity', className: 'Agent' },
    ])
    expect(kernel.presented.map((token) => credential.inspect(token).sub)).toEqual(['root', 'root'])
    access.close()
  })

  test('labels an Identity by its email, its name, its subject, else its id', () => {
    const domain = node('domain', K.classes.Domain.key, {
      [K.classes.Domain.properties.origin.key]: 'crm.example',
    })
    const subject = node('subject', 'idp.example:class.Account', {
      'idp.example:class.Account.property.sub': 'auth0|42',
    })
    const bare = node('bare', 'idp.example:class.Account', {})
    expect([domain, subject, bare].map(identityLabel)).toEqual(['crm.example', 'auth0|42', 'bare'])
    expect(listIdentities([bare], []).map(({ id }) => id)).toEqual([null, 'bare'])
  })
})
