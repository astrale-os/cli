import { expect, test } from 'bun:test'

import type { ConnectionContext } from '../session'
import type { AdminConnectionOptions } from '../target'

import { lookupManagedInstance } from '../session'

test('implicit managed target discovery keeps target credentials out of the Admin lookup', async () => {
  const owned = {
    id: 'owned-id',
    slug: 'owned',
    url: 'https://owned.eu.astrale.ai',
    state: 'ready',
  }
  const opened: AdminConnectionOptions[] = []
  const openAdmin = async <Value>(
    options: AdminConnectionOptions,
    action: (context: ConnectionContext) => Promise<Value>,
  ): Promise<Value> => (opened.push(options), action({} as ConnectionContext))
  const connect = async () => ({ list: async () => [owned] }) as never
  const target = { as: 'target-identity', creds: 'target-delegation', timeout: '45000' }

  await lookupManagedInstance('owned', target, openAdmin, connect)
  expect(opened).toEqual([{ timeout: '45000' }])
})
