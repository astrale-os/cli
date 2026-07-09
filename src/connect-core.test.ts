import { describe, expect, test } from 'bun:test'

import * as C from './connect-core'

// Guards the frozen export surface `@astrale-os/connect-host` borrows. If a
// re-export name drifts (renamed / dropped upstream), this smoke fails loudly
// instead of the connect-host adapter breaking at type-check time in another
// submodule.
describe('connect-core barrel', () => {
  test('re-exports every borrowed function', () => {
    expect(C.readIdentities).toBeTypeOf('function')
    expect(C.getDefault).toBeTypeOf('function')
    expect(C.getIdentity).toBeTypeOf('function')
    expect(C.signAs).toBeTypeOf('function')
    expect(C.listIdentityKeys).toBeTypeOf('function')
    expect(C.readInstances).toBeTypeOf('function')
    expect(C.resetInstancesMemo).toBeTypeOf('function')
    expect(C.resolveInstance).toBeTypeOf('function')
    expect(C.normalizeInstanceKernelUrl).toBeTypeOf('function')
    expect(C.orgIdForAudience).toBeTypeOf('function')
    expect(C.resolveInstanceTarget).toBeTypeOf('function')
    expect(C.readConfig).toBeTypeOf('function')
    expect(C.resolveCredential).toBeTypeOf('function')
    expect(C.fetchWithCaFile).toBeTypeOf('function')
    expect(C.createPaths).toBeTypeOf('function')
    expect(C.loginViaIdp).toBeTypeOf('function')
    expect(C.resolveIdpName).toBeTypeOf('function')
    expect(C.readIdpSession).toBeTypeOf('function')
    expect(C.isSessionExpired).toBeTypeOf('function')
  })

  test('re-exports the error classes', () => {
    expect(C.AuthError).toBeTypeOf('function')
    expect(C.IdpRefreshTransientError).toBeTypeOf('function')
    expect(C.IdpOrgMembershipError).toBeTypeOf('function')
  })

  test('re-exports the paths singleton', () => {
    expect(C.paths).toBeTypeOf('object')
    expect(C.paths.home).toBeTypeOf('string')
  })
})
