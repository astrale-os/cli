import { describe, expect, test } from 'bun:test'

import { IdentifierCollisionError, ReservedSlugError } from '../../errors'
import { InstanceStoreSchema, assertNoCollision, resolveInstanceKey } from '../instance'
import { validateSlug } from '../validation'

const baseStore = InstanceStoreSchema.parse({
  active: 'manager',
  instances: {
    manager: {
      url: 'http://localhost:4400/mngt',
      createdAt: '2024-01-01T00:00:00Z',
      slug: 'manager',
      kind: 'manager',
      mode: 'local',
    },
    staging: {
      url: 'https://staging.example.com',
      createdAt: '2024-02-01T00:00:00Z',
      slug: 'staging',
      name: 'Staging Cluster',
      kind: 'bookmark',
      mode: 'remote',
    },
    localdev: {
      createdAt: '2024-02-02T00:00:00Z',
      slug: 'localdev',
      kind: 'local-child',
      mode: 'local',
    },
  },
})

describe('DESIGN — §4.7 slug + namespace', () => {
  test('validateSlug accepts URL-safe slugs', () => {
    expect(() => validateSlug('foo')).not.toThrow()
    expect(() => validateSlug('foo-bar')).not.toThrow()
    expect(() => validateSlug('f00-bar-1')).not.toThrow()
  })

  test('validateSlug rejects invalid slugs', () => {
    expect(() => validateSlug('Foo')).toThrow(/Invalid slug/)
    expect(() => validateSlug('-foo')).toThrow(/Invalid slug/)
    expect(() => validateSlug('foo_bar')).toThrow(/Invalid slug/)
    expect(() => validateSlug('foo.bar')).toThrow(/Invalid slug/)
    expect(() => validateSlug('')).toThrow(/Invalid slug/)
  })

  test('validateSlug rejects reserved "manager"', () => {
    expect(() => validateSlug('manager')).toThrow(ReservedSlugError)
  })

  test('assertNoCollision rejects existing key', () => {
    expect(() => assertNoCollision(baseStore, ['staging'])).toThrow(IdentifierCollisionError)
  })

  test('assertNoCollision rejects existing slug', () => {
    expect(() => assertNoCollision(baseStore, ['localdev'])).toThrow(IdentifierCollisionError)
  })

  test('assertNoCollision rejects existing name', () => {
    expect(() => assertNoCollision(baseStore, ['Staging Cluster'])).toThrow(
      IdentifierCollisionError,
    )
  })

  test('assertNoCollision accepts new identifier', () => {
    expect(() => assertNoCollision(baseStore, ['newname'])).not.toThrow()
  })

  test('assertNoCollision ignoreKey skips that entry', () => {
    expect(() =>
      assertNoCollision(baseStore, ['staging', 'Staging Cluster'], 'staging'),
    ).not.toThrow()
  })
})

describe('DESIGN — §7 resolver', () => {
  test('resolveInstanceKey matches by key', () => {
    expect(resolveInstanceKey(baseStore, 'staging')).toBe('staging')
  })

  test('resolveInstanceKey matches by slug', () => {
    expect(resolveInstanceKey(baseStore, 'localdev')).toBe('localdev')
  })

  test('resolveInstanceKey matches by name', () => {
    expect(resolveInstanceKey(baseStore, 'Staging Cluster')).toBe('staging')
  })

  test('resolveInstanceKey returns null on miss', () => {
    expect(resolveInstanceKey(baseStore, 'nope')).toBeNull()
  })
})

describe('DESIGN — backward compat registry', () => {
  test('legacy store without kind/slug/mode parses', () => {
    const legacy = InstanceStoreSchema.parse({
      active: 'old',
      instances: { old: { url: 'http://x', createdAt: '2023-01-01' } },
    })
    expect(legacy.instances.old.kind).toBeUndefined()
    expect(legacy.instances.old.mode).toBeUndefined()
  })
})
