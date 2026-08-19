import { describe, expect, test } from 'bun:test'

import type { ConnectionContext } from '../session'
import type { AdminConnectionOptions } from '../target'

import { lookupManagedInstance } from '../session'

describe('implicit managed target owner discovery', () => {
  test('keeps target credentials out of the admin inventory lookup', async () => {
    const owned = {
      id: 'owned-id',
      slug: 'owned',
      url: 'https://owned.eu.astrale.ai',
      state: 'ready',
    } as const
    let capturedOptions: AdminConnectionOptions | undefined
    const openAdmin = async <Value>(
      options: AdminConnectionOptions,
      action: (context: ConnectionContext) => Promise<Value>,
    ): Promise<Value> => {
      capturedOptions = options
      return action({} as ConnectionContext)
    }
    const connect = async () => ({ list: async () => [owned] }) as never

    await lookupManagedInstance(
      'owned',
      {
        as: 'target-identity',
        creds: 'target-delegation',
        timeout: '45000',
      },
      openAdmin,
      connect,
    )

    expect(capturedOptions).toEqual({ timeout: '45000' })
  })
})
