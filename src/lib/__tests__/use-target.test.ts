import { describe, expect, test } from 'bun:test'

import type { IdentityStore } from '../../identity/index'
import type { InstanceStore } from '../instance'

import { resolveUseTarget } from '../use-target'

const instances: InstanceStore = {
  active: 'staging',
  instances: {
    staging: { url: 'https://staging.example.com', slug: 'stage' },
    prod: { url: 'https://prod.example.com' },
  },
}

const identities: IdentityStore = {
  default: 'alice',
  identities: {
    alice: { subject: 'alice', createdAt: '2026-01-01T00:00:00.000Z', source: 'key' },
    prod: { subject: 'prod-user', createdAt: '2026-01-01T00:00:00.000Z', source: 'key' },
  },
}

describe('resolveUseTarget', () => {
  test('resolves identity-only names', () => {
    expect(resolveUseTarget('alice', instances, identities)).toEqual({
      kind: 'identity',
      name: 'alice',
    })
  })

  test('resolves instance keys and slugs', () => {
    expect(resolveUseTarget('staging', instances, identities)).toEqual({
      kind: 'instance',
      name: 'staging',
    })
    expect(resolveUseTarget('stage', instances, identities)).toEqual({
      kind: 'instance',
      name: 'staging',
    })
  })

  test('refuses ambiguous names', () => {
    expect(resolveUseTarget('prod', instances, identities)).toEqual({
      kind: 'ambiguous',
      name: 'prod',
    })
  })

  test('reports missing names', () => {
    expect(resolveUseTarget('missing', instances, identities)).toEqual({
      kind: 'missing',
      name: 'missing',
    })
  })
})
