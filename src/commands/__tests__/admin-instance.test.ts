import { describe, expect, test } from 'bun:test'

import { buildAdminCreateInstanceInput } from '../../lib/admin-instance'

describe('admin-backed instance commands', () => {
  test('builds AdminKernelInstance.create input from CLI options', async () => {
    const input = await buildAdminCreateInstanceInput('demo', {
      label: 'Demo',
      hostId: 'prod-host',
      graphName: 'demo-graph',
      issuer: 'https://demo.example.com',
      ownerId: 'user_123',
      ownerEmail: 'user@example.com',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      installDistribution: false,
      seedUser: false,
      disableDiscovery: true,
    })

    expect(input).toEqual({
      id: 'demo',
      label: 'Demo',
      hostId: 'prod-host',
      graphName: 'demo-graph',
      issuer: 'https://demo.example.com',
      owner: {
        id: 'user_123',
        email: 'user@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
      installDistribution: false,
      seedUser: false,
      enableDiscovery: false,
    })
  })

  test('defaults owner id to instance id when no local identity exists', async () => {
    const input = await buildAdminCreateInstanceInput('demo', {})

    expect(input.owner.id).toBe('demo')
    expect(input.installDistribution).toBe(true)
    expect(input.seedUser).toBe(true)
  })
})
