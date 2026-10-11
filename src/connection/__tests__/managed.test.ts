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

test('refuses a slug held in two Fleets instead of connecting to either', async () => {
  const instance = (id: string, fleetId: string) => ({
    id,
    fleetId,
    slug: 'shared-name',
    url: `https://${id}.eu.astrale.ai`,
    state: 'ready',
  })
  const openAdmin = async <Value>(
    _options: AdminConnectionOptions,
    action: (context: ConnectionContext) => Promise<Value>,
  ): Promise<Value> => action({} as ConnectionContext)
  const connect = async () =>
    ({ list: async () => [instance('@a', '@fleet-a'), instance('@b', '@fleet-b')] }) as never

  await expect(lookupManagedInstance('shared-name', {}, openAdmin, connect)).rejects.toThrow(
    'Instance slug is ambiguous.',
  )
})
