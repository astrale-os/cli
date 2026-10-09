import { describe, expect, test } from 'bun:test'

import { IdentifierCollisionError, ReservedSlugError } from '../../errors'
import { InstanceStoreSchema, assertNoCollision, resolveInstanceKey } from '../instance'
import { validateSlug } from '../validation'

const baseStore = InstanceStoreSchema.parse({
  version: 1,
  active: 'staging',
  instances: {
    staging: {
      url: 'https://staging.example.com',
      createdAt: '2024-02-01T00:00:00Z',
      slug: 'staging',
      name: 'Staging Cluster',
      kind: 'bookmark',
      mode: 'remote',
    },
    localdev: {
      url: 'https://localdev.example.com',
      createdAt: '2024-02-02T00:00:00Z',
      slug: 'localdev',
      kind: 'bookmark',
      mode: 'remote',
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

  test('reserves host while treating manager as an ordinary user slug', () => {
    expect(() => validateSlug('host')).toThrow(ReservedSlugError)
    expect(() => validateSlug('manager')).not.toThrow()
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

describe('DESIGN — V1 bookmark registry', () => {
  test('requires its version while keeping optional bookmark metadata optional', () => {
    const fields = { active: 'current', instances: { current: { url: 'http://x' } } }
    expect(() => InstanceStoreSchema.parse(fields)).toThrow()
    const current = InstanceStoreSchema.parse({ version: 1, ...fields })
    expect(current.instances.current.kind).toBeUndefined()
    expect(current.instances.current.mode).toBeUndefined()
  })
})
