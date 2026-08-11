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
    let capturedCall: unknown
    const openAdmin = async <Value>(
      options: AdminConnectionOptions,
      action: (context: ConnectionContext) => Promise<Value>,
    ): Promise<Value> => {
      capturedOptions = options
      return action({
        host: {
          call: async (call: unknown) => {
            capturedCall = call
            return owned
          },
        },
      } as unknown as ConnectionContext)
    }

    await lookupManagedInstance(
      'owned',
      {
        as: 'target-identity',
        creds: 'target-delegation',
        timeout: '45000',
      },
      openAdmin,
    )

    expect(capturedOptions).toEqual({ timeout: '45000' })
    const call = capturedCall as {
      target: { kind: string; path: unknown }
      input: unknown
    }
    expect(call.target.kind).toBe('path')
    expect(String(call.target.path)).toBe('/:admin.astrale.ai:class.Instance:info')
    expect(call.input).toEqual({ id: 'owned' })
  })
})
