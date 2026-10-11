import { expect, test } from 'bun:test'

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

test.each([
  ['alice', 'identity', 'alice'],
  ['staging', 'instance', 'staging'],
  ['stage', 'instance', 'staging'],
  ['prod', 'ambiguous', 'prod'],
  ['missing', 'missing', 'missing'],
] as const)('resolveUseTarget(%p) is %s %p', (input, kind, name) => {
  expect(resolveUseTarget(input, instances, identities)).toEqual({ kind, name })
})
