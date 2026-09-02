import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { classifyAdminInventoryError, readAdminInventory } from '../instance/list'

const TEST_INVOCATION = {
  source: 'https://admin.test',
  id: 'instance-list',
} as ConstructorParameters<typeof ResponseError>[2]

const backendUnavailable = () =>
  new ResponseError(5001, 'Authentication is unavailable.', TEST_INVOCATION)

describe('Admin inventory failures', () => {
  test('turns key-backed Admin exchange failures into a bookmark-only instruction', () => {
    const error = classifyAdminInventoryError(
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
    const error = classifyAdminInventoryError(
      new AstraleError('ADMIN_DOMAIN_ISSUER_MISSING', 'no Domain issuer'),
    )
    expect(error.code).toBe('ADMIN_INVENTORY_UNAVAILABLE')
    expect(error.hint).toContain('Key-backed identities cannot mint an Admin Domain token')
  })

  test('retries one transient backend failure for the idempotent inventory read', async () => {
    let attempts = 0
    const inventory = await readAdminInventory(async () => {
      attempts += 1
      if (attempts === 1) throw backendUnavailable()
      return ['bryan']
    })

    expect(inventory).toEqual(['bryan'])
    expect(attempts).toBe(2)
  })

  test('reports a persistent authentication backend failure honestly', async () => {
    const cause = backendUnavailable()

    await expect(readAdminInventory(async () => Promise.reject(cause))).rejects.toBe(cause)
    const error = classifyAdminInventoryError(cause)
    expect(error.code).toBe('ADMIN_BACKEND_UNAVAILABLE')
    expect(error.message).toBe('Authentication is unavailable.')
    expect(error.hint).toContain('failed twice')
    expect(error.hint).toContain('Retry the command')
  })

  test('does not retry caller or policy errors', async () => {
    const cause = new ResponseError(2004, 'Access denied.', TEST_INVOCATION)
    let attempts = 0

    await expect(
      readAdminInventory(async () => {
        attempts += 1
        throw cause
      }),
    ).rejects.toBe(cause)
    expect(attempts).toBe(1)
  })
})
