import { describe, expect, test } from 'bun:test'

import {
  findBookmarkTrustConflicts,
  InstanceStoreSchema,
  managedShellDomainIssuer,
  normalizeInstanceKernelUrl,
  sanitizeStore,
} from '../instance'

describe('InstanceStoreSchema', () => {
  test('parses valid store with url', () => {
    const result = InstanceStoreSchema.parse({
      active: 'prod',
      instances: {
        prod: { url: 'https://prod.example.com', createdAt: '2024-01-01T00:00:00Z' },
      },
    })
    expect(result.active).toBe('prod')
    expect(result.instances.prod.url).toBe('https://prod.example.com')
  })

  test('parses legacy instance without url for migration compatibility', () => {
    const result = InstanceStoreSchema.parse({
      active: 'dev',
      instances: {
        dev: { createdAt: '2024-01-01T00:00:00Z' },
      },
    })
    expect(result.instances.dev.url).toBeUndefined()
  })

  test('parses multiple instances', () => {
    const result = InstanceStoreSchema.parse({
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
        instances: { m: { createdAt: '2024-01-01' } },
      }),
    ).toThrow()
  })

  test('accepts instance without createdAt (optional at schema level)', () => {
    // `createdAt` is intentionally optional on InstanceEntrySchema: only
    // `createdAt` is metadata; the connection URL is the only required
    // field for a usable bookmark.
    const result = InstanceStoreSchema.parse({
      active: 'm',
      instances: { m: { url: 'http://test' } },
    })
    expect(result.instances.m.createdAt).toBeUndefined()
  })

  test('accepts empty instances record', () => {
    const result = InstanceStoreSchema.parse({
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

  test('resolves the trusted Shell issuer only for managed public routes', () => {
    expect(managedShellDomainIssuer('https://bryan.eu.beta.astrale.ai/api')).toBe(
      'https://shell.beta.astrale.ai',
    )
    expect(managedShellDomainIssuer('https://bryan.eu.astrale.ai/api')).toBe(
      'https://shell.astrale.ai',
    )
    expect(managedShellDomainIssuer('https://kernel.example.com/api')).toBeUndefined()
    expect(managedShellDomainIssuer('http://bryan.eu.beta.astrale.ai/api')).toBeUndefined()
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

  test('repairs a managed bookmark with its trusted Shell issuer on ordinary reads', () => {
    const store = {
      active: 'bryan',
      instances: {
        bryan: {
          url: 'https://bryan.eu.beta.astrale.ai/api',
          issuer: 'https://bryan.eu.beta.astrale.ai/api',
          slug: 'bryan',
          name: 'bryan',
          kind: 'bookmark' as const,
        },
      },
    }

    const { store: repaired, changed } = sanitizeStore(store)

    expect(changed).toBe(true)
    expect(repaired.instances.bryan.domainIssuer).toBe('https://shell.beta.astrale.ai')
  })

  test('does not infer a Shell issuer for an ordinary bookmark on an official hostname', () => {
    const store = {
      active: 'control',
      instances: {
        control: {
          url: 'https://admin.eu.beta.astrale.ai/api',
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
