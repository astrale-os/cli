import { describe, expect, test } from 'bun:test'

import {
  bookmarkExchangeDomain,
  findBookmarkTrustConflicts,
  InstanceStoreSchema,
  managedShellOrigin,
  normalizeInstanceKernelUrl,
  sanitizeStore,
} from '../instance'

describe('InstanceStoreSchema', () => {
  test('parses valid store with url', () => {
    const result = InstanceStoreSchema.parse({
      version: 1,
      active: 'prod',
      instances: {
        prod: { url: 'https://prod.example.com', createdAt: '2024-01-01T00:00:00Z' },
      },
    })
    expect(result.active).toBe('prod')
    expect(result.instances.prod.url).toBe('https://prod.example.com')
  })

  test('refuses a persisted bookmark without its connection URL', () => {
    expect(() =>
      InstanceStoreSchema.parse({
        version: 1,
        active: 'dev',
        instances: {
          dev: { createdAt: '2024-01-01T00:00:00Z' },
        },
      }),
    ).toThrow()
  })

  test('parses multiple instances', () => {
    const result = InstanceStoreSchema.parse({
      version: 1,
      active: 'prod',
      instances: {
        local: { url: 'https://local.example.com', createdAt: '2024-01-01T00:00:00Z' },
        prod: { url: 'https://prod.example.com', createdAt: '2024-06-01T00:00:00Z' },
      },
    })
    expect(Object.keys(result.instances)).toHaveLength(2)
  })

  test('rejects missing active field', () => {
    expect(() =>
      InstanceStoreSchema.parse({
        version: 1,
        instances: { m: { createdAt: '2024-01-01' } },
      }),
    ).toThrow()
  })

  test('accepts instance without createdAt (optional at schema level)', () => {
    // `createdAt` is intentionally optional on InstanceEntrySchema: only
    // `createdAt` is metadata; the connection URL is the only required
    // field for a usable bookmark.
    const result = InstanceStoreSchema.parse({
      version: 1,
      active: 'm',
      instances: { m: { url: 'http://test' } },
    })
    expect(result.instances.m.createdAt).toBeUndefined()
  })

  test('accepts empty instances record', () => {
    const result = InstanceStoreSchema.parse({
      version: 1,
      active: 'none',
      instances: {},
    })
    expect(Object.keys(result.instances)).toHaveLength(0)
  })

  test('normalizes region-routed managed instance roots to the kernel api URL', () => {
    expect(normalizeInstanceKernelUrl('https://testmarc.eu.astrale.ai')).toBe(
      'https://testmarc.eu.astrale.ai/api',
    )
    expect(normalizeInstanceKernelUrl('https://testmarc.eu.astrale.ai/')).toBe(
      'https://testmarc.eu.astrale.ai/api',
    )
    expect(normalizeInstanceKernelUrl('https://testmarc.eu.beta.astrale.ai')).toBe(
      'https://testmarc.eu.beta.astrale.ai/api',
    )
    expect(normalizeInstanceKernelUrl('https://shell.beta.astrale.ai')).toBe(
      'https://shell.beta.astrale.ai',
    )
  })

  test('does not rewrite explicit kernel or non-managed URLs', () => {
    expect(normalizeInstanceKernelUrl('https://testmarc.eu.astrale.ai/api')).toBe(
      'https://testmarc.eu.astrale.ai/api',
    )
    expect(normalizeInstanceKernelUrl('https://localhost:8443/kernel/host')).toBe(
      'https://localhost:8443/kernel/host',
    )
    expect(normalizeInstanceKernelUrl('https://scw-admin.astrale.ai')).toBe(
      'https://scw-admin.astrale.ai',
    )
    expect(normalizeInstanceKernelUrl('https://testmarc.svc.eu.astrale.ai')).toBe(
      'https://testmarc.svc.eu.astrale.ai',
    )
    expect(normalizeInstanceKernelUrl('https://testmarc.eu.astrale.ai?debug=1')).toBe(
      'https://testmarc.eu.astrale.ai?debug=1',
    )
  })

  test('exchanges managed public routes through the installed Shell', () => {
    expect(managedShellOrigin('https://bryan.eu.beta.astrale.ai/api')).toBe('shell.astrale.ai')
    expect(managedShellOrigin('https://bryan.eu.astrale.ai/api')).toBe('shell.astrale.ai')
    expect(managedShellOrigin('https://kernel.example.com/api')).toBeUndefined()
    expect(managedShellOrigin('http://bryan.eu.astrale.ai/api')).toBeUndefined()
  })

  test('a bookmark exchanges at its explicit issuer, else a managed one through the Shell origin', () => {
    const url = 'https://bryan.eu.astrale.ai/api'
    expect(bookmarkExchangeDomain({ slug: 'bryan', name: 'bryan' }, url)).toEqual({
      domainOrigin: 'shell.astrale.ai',
    })
    // An explicit exact issuer keeps its single meaning, on a managed bookmark too.
    expect(
      bookmarkExchangeDomain(
        { slug: 'bryan', name: 'bryan', domainIssuer: 'https://shell-dev.example' },
        url,
      ),
    ).toEqual({ domainIssuer: 'https://shell-dev.example' })
    expect(
      bookmarkExchangeDomain({ name: 'bryan', domainIssuer: 'https://crm.example' }, url),
    ).toEqual({ domainIssuer: 'https://crm.example' })
    expect(bookmarkExchangeDomain({ name: 'bryan' }, url)).toEqual({})
    expect(
      bookmarkExchangeDomain(
        { slug: 'local', name: 'local', domainIssuer: 'http://shell.localhost' },
        'http://localhost:8080/api',
      ),
    ).toEqual({ domainIssuer: 'http://shell.localhost' })
  })
})

describe('sanitizeStore — read must not rewrite', () => {
  test('an already-normalized store reports changed=false', () => {
    // `changed` was computed via OBJECT IDENTITY (always true), so every
    // read rewrote instances.json fire-and-forget — concurrent astrale
    // processes clobbered each other's `active` from stale snapshots and
    // calls silently targeted the wrong instance.
    const store = {
      active: 'a',
      instances: {
        a: { url: 'https://a.example/api', kind: 'bookmark' as const },
      },
    }
    const { changed } = sanitizeStore(store)
    expect(changed).toBe(false)
  })

  test('a dangling active pointer is preserved (not silently re-aimed)', () => {
    const store = {
      active: 'ghost',
      instances: { a: { url: 'https://a.example/api', kind: 'bookmark' as const } },
    }
    const { store: out } = sanitizeStore(store)
    expect(out.active).toBe('ghost')
  })

  test('organizationId survives sanitize without flagging a rewrite', () => {
    // The org id captured at `instance create` is what makes token scoping
    // immune to the router's eventually-consistent /auth/org — losing it on
    // a read (or rewriting the file for it) would re-open the stale-org race.
    const store = {
      active: 'a',
      instances: {
        a: {
          url: 'https://a.example/api',
          kind: 'bookmark' as const,
          organizationId: 'org_123',
        },
      },
    }
    const { store: out, changed } = sanitizeStore(store)
    expect(out.instances.a.organizationId).toBe('org_123')
    expect(changed).toBe(false)
  })

  test('stores no Shell issuer for a managed bookmark', () => {
    const store = {
      active: 'bryan',
      instances: {
        bryan: {
          url: 'https://bryan.eu.astrale.ai/api',
          issuer: 'https://bryan.eu.astrale.ai/api',
          slug: 'bryan',
          name: 'bryan',
          kind: 'bookmark' as const,
        },
      },
    }

    const { store: retained, changed } = sanitizeStore(store)

    expect(changed).toBe(false)
    expect(retained.instances.bryan).not.toHaveProperty('domainIssuer')
  })

  /** @evidence TEST-CLI-INSTANCE-REGISTRY-ISSUER-KEPT */
  test.each([
    ['https://bryan.eu.beta.astrale.ai/api', 'https://shell.beta.astrale.ai'],
    ['https://bryan.eu.astrale.ai/api', 'https://shell.astrale.ai'],
  ])('keeps an explicit Shell issuer in a V1 registry on %s', (url, domainIssuer) => {
    const store = {
      active: 'bryan',
      instances: {
        bryan: {
          url,
          issuer: url,
          domainIssuer,
          slug: 'bryan',
          name: 'bryan',
          kind: 'bookmark' as const,
          organizationId: 'org_123',
        },
      },
    }

    const { store: retained, changed } = sanitizeStore(
      InstanceStoreSchema.parse({ version: 1, ...store }),
    )

    expect(changed).toBe(false)
    expect(retained.instances.bryan).toEqual(store.instances.bryan)
    expect(bookmarkExchangeDomain(retained.instances.bryan, url)).toEqual({ domainIssuer })
  })

  /** @evidence TEST-CLI-INSTANCE-LABELLED-REGISTRY-ISSUER-KEPT */
  test('keeps an explicit Shell issuer read from a labelled registry', () => {
    const url = 'https://bryan.eu.astrale.ai/api'
    const store = InstanceStoreSchema.parse({
      version: 1,
      active: 'bryan',
      instances: {
        bryan: {
          url,
          issuer: url,
          domainIssuer: 'https://shell.beta.astrale.ai',
          slug: 'bryan',
          name: 'bryan',
          kind: 'bookmark',
        },
      },
    })

    const { store: retained, changed } = sanitizeStore(store)

    expect(changed).toBe(false)
    expect(bookmarkExchangeDomain(retained.instances.bryan!, url)).toEqual({
      domainIssuer: 'https://shell.beta.astrale.ai',
    })
  })

  test('refuses an unversioned registry instead of interpreting it as V1', () => {
    expect(() => InstanceStoreSchema.parse({ active: '', instances: {} })).toThrow()
  })

  test('refuses a registry format this release does not know', () => {
    expect(() => InstanceStoreSchema.parse({ version: 2, active: '', instances: {} })).toThrow()
  })

  test('keeps an explicit Domain issuer on a managed bookmark', () => {
    const store = {
      active: 'bryan',
      instances: {
        bryan: {
          url: 'https://bryan.eu.astrale.ai/api',
          domainIssuer: 'https://shell-dev.example',
          slug: 'bryan',
          name: 'bryan',
          kind: 'bookmark' as const,
        },
      },
    }

    const { store: retained, changed } = sanitizeStore(store)

    expect(changed).toBe(false)
    expect(retained.instances.bryan.domainIssuer).toBe('https://shell-dev.example')
  })

  test('keeps an explicit Shell issuer a user set on a bookmark that is not managed', () => {
    const store = {
      active: 'shell',
      instances: {
        shell: {
          url: 'https://bryan.eu.astrale.ai/api',
          domainIssuer: 'https://shell.beta.astrale.ai',
          name: 'shell',
          kind: 'bookmark' as const,
        },
      },
    }

    const { store: retained, changed } = sanitizeStore(store)

    expect(changed).toBe(false)
    expect(retained.instances.shell.domainIssuer).toBe('https://shell.beta.astrale.ai')
  })

  test('keeps an explicit Domain issuer on a bookmark that is not a managed Instance', () => {
    const store = {
      active: 'crm',
      instances: {
        crm: {
          url: 'https://crm.eu.astrale.ai/api',
          domainIssuer: 'https://crm-domain.example',
          name: 'crm',
          kind: 'bookmark' as const,
        },
      },
    }

    const { store: retained, changed } = sanitizeStore(store)

    expect(changed).toBe(false)
    expect(retained.instances.crm.domainIssuer).toBe('https://crm-domain.example')
  })

  test('does not infer a Shell issuer for an ordinary bookmark on an official hostname', () => {
    const store = {
      active: 'control',
      instances: {
        control: {
          url: 'https://admin.eu.astrale.ai/api',
          kind: 'bookmark' as const,
        },
      },
    }

    const { store: retained, changed } = sanitizeStore(store)

    expect(changed).toBe(false)
    expect(retained.instances.control.domainIssuer).toBeUndefined()
  })
})

describe('bookmark TLS trust collisions', () => {
  test('finds the same normalized URL with a different CA configuration', () => {
    const store = InstanceStoreSchema.parse({
      version: 1,
      active: 'stable',
      instances: {
        stable: {
          url: 'https://local.example/kernel/',
          caFile: '/certs/stable.pem',
        },
        alias: {
          url: 'https://local.example/kernel',
          caFile: '/certs/old.pem',
        },
        other: {
          url: 'https://other.example/kernel',
          caFile: '/certs/old.pem',
        },
      },
    })

    expect(
      findBookmarkTrustConflicts(
        store,
        'stable',
        'https://local.example/kernel',
        '/certs/stable.pem',
      ),
    ).toEqual([{ name: 'alias', caFile: '/certs/old.pem' }])
  })

  test('treats custom CA versus system trust as a meaningful difference', () => {
    const store = InstanceStoreSchema.parse({
      version: 1,
      active: 'custom',
      instances: {
        custom: { url: 'https://local.example', caFile: '/certs/local.pem' },
        system: { url: 'https://local.example' },
      },
    })

    expect(
      findBookmarkTrustConflicts(store, 'custom', 'https://local.example', '/certs/local.pem'),
    ).toEqual([{ name: 'system', caFile: null }])
  })
})
