import { describe, expect, test } from 'bun:test'

import type { InstanceStore } from '../instance/bookmarks'

import { IdentifierCollisionError, ReservedSlugError } from '../../errors'
import {
  assertNoCollision,
  findBookmarkTrustConflicts,
  InstanceStoreSchema,
  isManagedRoute,
  normalizeInstanceKernelUrl,
  resolveInstanceKey,
  sanitizeStore,
} from '../instance/bookmarks'
import { validateName, validateSlug } from '../validation'

const store: InstanceStore = {
  active: 'staging',
  instances: {
    staging: { url: 'https://staging.example.com', slug: 'stage', name: 'Staging Cluster' },
    localdev: { url: 'https://localdev.example.com', slug: 'localdev' },
  },
}

describe('bookmark names', () => {
  test('a slug is a DNS label, and host is reserved', () => {
    for (const slug of ['foo', 'f00-bar-1', 'manager'])
      expect(() => validateSlug(slug)).not.toThrow()
    for (const slug of ['Foo', '-foo', 'foo_bar', 'foo.bar', '']) {
      expect(() => validateSlug(slug)).toThrow(/Invalid slug/)
    }
    expect(() => validateSlug('host')).toThrow(ReservedSlugError)
    expect(() => validateName('my.instance_1-a', 'Instance')).not.toThrow()
    expect(() => validateName('my instance', 'Identity')).toThrow(/Invalid identity name/)
  })

  test('a bookmark is found by key, slug or name, and no new identifier may shadow one', () => {
    expect(resolveInstanceKey(store, 'staging')).toBe('staging')
    expect(resolveInstanceKey(store, 'stage')).toBe('staging')
    expect(resolveInstanceKey(store, 'Staging Cluster')).toBe('staging')
    expect(resolveInstanceKey(store, 'nope')).toBeNull()
    for (const taken of ['staging', 'localdev', 'Staging Cluster']) {
      expect(() => assertNoCollision(store, [taken])).toThrow(IdentifierCollisionError)
    }
    expect(() => assertNoCollision(store, ['staging', 'Staging Cluster'], 'staging')).not.toThrow()
  })
})

describe('bookmark registry format', () => {
  test('refuses an unversioned registry or a version this release does not know', () => {
    expect(() => InstanceStoreSchema.parse({ active: '', instances: {} })).toThrow()
    expect(() => InstanceStoreSchema.parse({ version: 2, active: '', instances: {} })).toThrow()
    expect(() =>
      InstanceStoreSchema.parse({ version: 1, active: 'dev', instances: { dev: {} } }),
    ).toThrow()
  })

  test('normalizes only a region-routed managed instance root to its kernel API URL', () => {
    for (const [input, output] of [
      ['https://testmarc.eu.astrale.ai', 'https://testmarc.eu.astrale.ai/api'],
      ['https://testmarc.eu.astrale.ai/', 'https://testmarc.eu.astrale.ai/api'],
      ['https://testmarc.eu.astrale.ai/api', 'https://testmarc.eu.astrale.ai/api'],
      ['https://localhost:8443/kernel/host', 'https://localhost:8443/kernel/host'],
      ['https://testmarc.svc.eu.astrale.ai', 'https://testmarc.svc.eu.astrale.ai'],
      ['https://testmarc.eu.beta.astrale.ai', 'https://testmarc.eu.beta.astrale.ai'],
      ['https://testmarc.eu.astrale.ai?debug=1', 'https://testmarc.eu.astrale.ai?debug=1'],
    ]) {
      expect(normalizeInstanceKernelUrl(input!)).toBe(output!)
    }
  })

  test('a read of a normalized registry rewrites nothing and keeps every recorded field', () => {
    const recorded: InstanceStore = {
      active: 'ghost',
      instances: {
        a: { url: 'https://a.example/api', kind: 'bookmark', organizationId: 'org_123' },
      },
    }
    // A dangling active pointer is kept, never silently re-aimed.
    expect(sanitizeStore(recorded)).toEqual(recorded)
  })

  /** @evidence TEST-CLI-INSTANCE-LABELLED-REGISTRY-ISSUER-KEPT */
  test('a bookmark keeps the explicit issuer its user set; a managed one stores none', () => {
    const managed = 'https://bryan.eu.astrale.ai/api'
    expect(isManagedRoute(managed)).toBe(true)
    expect(isManagedRoute('https://bryan.eu.beta.astrale.ai/api')).toBe(true)
    expect(isManagedRoute('http://bryan.eu.astrale.ai/api')).toBe(false)
    expect(isManagedRoute('https://kernel.example.com/api')).toBe(false)

    const registry = InstanceStoreSchema.parse({
      version: 1,
      active: 'bryan',
      instances: {
        bryan: { url: managed, issuer: managed, slug: 'bryan', name: 'bryan', kind: 'bookmark' },
        dev: {
          url: managed,
          domainIssuer: 'https://shell-dev.example',
          slug: 'dev',
          name: 'dev',
          kind: 'bookmark',
        },
        crm: {
          url: 'https://crm.eu.astrale.ai/api',
          domainIssuer: 'https://crm.example',
          kind: 'bookmark',
        },
        control: { url: 'https://admin.eu.astrale.ai/api', kind: 'bookmark' },
      },
    })
    const read = sanitizeStore(registry)
    expect(read).toEqual({ active: registry.active, instances: registry.instances })
    expect(read.instances.bryan).not.toHaveProperty('domainIssuer')
    expect(read.instances.dev?.domainIssuer).toBe('https://shell-dev.example')
    expect(read.instances.crm?.domainIssuer).toBe('https://crm.example')
  })

  test('finds another bookmark of the same Kernel URL under different TLS trust', () => {
    const registry = InstanceStoreSchema.parse({
      version: 1,
      active: 'stable',
      instances: {
        stable: { url: 'https://local.example/kernel/', caFile: '/certs/stable.pem' },
        alias: { url: 'https://local.example/kernel', caFile: '/certs/old.pem' },
        system: { url: 'https://local.example/kernel' },
        other: { url: 'https://other.example/kernel', caFile: '/certs/old.pem' },
      },
    })
    expect(
      findBookmarkTrustConflicts(
        registry,
        'stable',
        'https://local.example/kernel',
        '/certs/stable.pem',
      ),
    ).toEqual([
      { name: 'alias', caFile: '/certs/old.pem' },
      { name: 'system', caFile: null },
    ])
  })
})
