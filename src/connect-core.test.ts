import { describe, expect, test } from 'bun:test'

import type { AdminConnectionOptions, ConnectionContext } from './connect-core'

import * as compatibility from './connect-core'

describe('connect-core compatibility barrel', () => {
  test('retains the functions borrowed by connect-host', () => {
    for (const value of [
      compatibility.readIdentities,
      compatibility.getDefault,
      compatibility.getIdentity,
      compatibility.signAs,
      compatibility.listIdentityKeys,
      compatibility.readInstances,
      compatibility.resetInstancesMemo,
      compatibility.resolveInstance,
      compatibility.normalizeInstanceKernelUrl,
      compatibility.orgIdForAudience,
      compatibility.resolveInstanceTarget,
      compatibility.readConfig,
      compatibility.resolveCredential,
      compatibility.withAdminClientSession,
      compatibility.fetchWithCaFile,
      compatibility.createPaths,
      compatibility.loginViaIdp,
      compatibility.resolveIdpName,
      compatibility.readIdpSession,
      compatibility.isSessionExpired,
    ]) {
      expect(value).toBeTypeOf('function')
    }
  })

  test('retains typed errors and the captured paths singleton', () => {
    expect(compatibility.AuthError).toBeTypeOf('function')
    expect(compatibility.IdpRefreshTransientError).toBeTypeOf('function')
    expect(compatibility.IdpOrgMembershipError).toBeTypeOf('function')
    expect(compatibility.paths.home).toBeTypeOf('string')
  })

  test('exposes the complete typed Admin session seam', () => {
    const connect: <Value>(
      options: AdminConnectionOptions,
      action: (context: ConnectionContext) => Promise<Value>,
    ) => Promise<Value> = compatibility.withAdminClientSession

    expect(connect).toBe(compatibility.withAdminClientSession)
  })
})
