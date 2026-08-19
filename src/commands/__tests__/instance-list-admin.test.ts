import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { adminInventoryUnavailable } from '../instance/list'

describe('adminInventoryUnavailable', () => {
  test('turns key-backed Admin exchange failures into a bookmark-only instruction', () => {
    const error = adminInventoryUnavailable(
      new AstraleError(
        'TOKEN_EXCHANGE_SOURCE_INVALID',
        'The source identity credential has no valid expiration.',
      ),
    )
    expect(error.code).toBe('ADMIN_INVENTORY_UNAVAILABLE')
    expect(error.message).toContain('Admin is not deployed')
    expect(error.hint).toContain('instance list --bookmarked')
  })

  test('turns a missing Admin Domain issuer into the same instruction', () => {
    const error = adminInventoryUnavailable(
      new AstraleError('ADMIN_DOMAIN_ISSUER_MISSING', 'no Domain issuer'),
    )
    expect(error.code).toBe('ADMIN_INVENTORY_UNAVAILABLE')
    expect(error.hint).toContain('Key-backed identities cannot mint an Admin Domain token')
  })
})
