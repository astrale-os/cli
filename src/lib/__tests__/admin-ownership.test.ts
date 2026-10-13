import { describe, expect, test } from 'bun:test'

import { kernelKey, matchAdminInstance, notOwnerError } from '../admin/ownership'

const instance = (overrides: Partial<{ url: string; issuer: string; state: string }> = {}) =>
  ({
    url: 'https://demo.eu.astrale.ai',
    issuer: 'https://demo.eu.astrale.ai/api',
    state: 'ready',
    ...overrides,
  }) as { url: string; issuer?: string; state: 'ready' | 'deleted' }

describe('Admin Instance behind a local Kernel', () => {
  test('compares Kernels in one form: region-routed roots at /api, no trailing slash', () => {
    expect(kernelKey('https://demo.eu.astrale.ai')).toBe('https://demo.eu.astrale.ai/api')
    expect(kernelKey('https://demo.eu.astrale.ai/api/')).toBe('https://demo.eu.astrale.ai/api')
    expect(kernelKey('http://127.0.0.1:7200/')).toBe('http://127.0.0.1:7200')
    expect(kernelKey('not a url')).toBeUndefined()
    expect(kernelKey(null)).toBeUndefined()
  })

  test('the Kernel issuer decides when Admin records one; the URL only otherwise', () => {
    const owned = instance()
    expect(matchAdminInstance({ url: 'https://demo.eu.astrale.ai/api' }, [owned])).toBe(owned)
    // A bookmark whose issuer is the Instance's matches whatever URL routes to it.
    expect(
      matchAdminInstance(
        { url: 'https://proxy.example/demo', issuer: 'https://demo.eu.astrale.ai/api/' },
        [owned],
      ),
    ).toBe(owned)
    // Same URL, another issuer: another Kernel.
    expect(
      matchAdminInstance(
        { url: 'https://demo.eu.astrale.ai/api', issuer: 'https://elsewhere.example' },
        [owned],
      ),
    ).toBeUndefined()
    const legacy = instance({ issuer: undefined })
    delete legacy.issuer
    expect(matchAdminInstance({ url: 'https://demo.eu.astrale.ai/' }, [legacy])).toBe(legacy)
    expect(matchAdminInstance({ url: 'http://127.0.0.1:7200' }, [owned, legacy])).toBeUndefined()
  })

  test('a retired Instance never matches, and two live claims match nothing', () => {
    const live = instance()
    expect(matchAdminInstance({ url: live.issuer }, [instance({ state: 'deleted' }), live])).toBe(
      live,
    )
    expect(matchAdminInstance({ url: live.issuer }, [live, instance()])).toBe('ambiguous')
  })

  test('a refusal says the user is not the owner, and why', () => {
    expect(notOwnerError({ status: 'not-owner', instance: '@demo' })).toMatchObject({
      code: 'INSTANCE_NOT_OWNED',
      message:
        'You are not the owner of this instance in Admin: Admin does not record you as its owner.',
    })
    expect(notOwnerError({ status: 'not-managed' }).message).toContain('a local or foreign Kernel')
  })
})
