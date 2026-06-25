import { describe, expect, test } from 'bun:test'

import type { SelfResolverContext } from '../../lib/self'

import { resolveSelfIdLazy } from '../expand'

describe('resolveSelfIdLazy', () => {
  test('refreshes a cached IdP @self registration via whoami', async () => {
    const writes: unknown[][] = []
    const ctx: SelfResolverContext = {
      identity: {
        name: 'bryan',
        subject: 'user_01KC9MW1M6S5J6V9ERSRJ8RDYF',
        createdAt: '2026-06-25T08:00:00.000Z',
        source: 'idp',
        registrations: {
          bryan: {
            iss: 'https://old.example',
            sub: '4ad8e4ce-5cf7-4c2e-ab29-5549023dc8bf',
            registeredAt: '2026-06-25T08:00:00.000Z',
          },
        },
      },
      instanceSlug: 'bryan',
      instanceSigned: false,
    }

    const id = await resolveSelfIdLazy(
      ctx,
      {},
      {
        whoami: async () => ({
          id: 'f011538e-9edc-4c29-92ce-9b81b6c1b6c7',
          kernelUrl: 'https://bryan.example',
        }),
        setRegistration: async (...args) => {
          writes.push(args)
        },
        now: () => new Date('2026-06-25T08:15:00.000Z'),
      },
    )

    expect(id).toBe('f011538e-9edc-4c29-92ce-9b81b6c1b6c7')
    expect(writes).toEqual([
      [
        'bryan',
        'bryan',
        {
          iss: 'https://bryan.example',
          sub: 'f011538e-9edc-4c29-92ce-9b81b6c1b6c7',
          registeredAt: '2026-06-25T08:15:00.000Z',
        },
      ],
    ])
  })

  test('keeps the cached IdP id when whoami is temporarily unavailable', async () => {
    const ctx: SelfResolverContext = {
      identity: {
        name: 'bryan',
        subject: 'user_01KC9MW1M6S5J6V9ERSRJ8RDYF',
        createdAt: '2026-06-25T08:00:00.000Z',
        source: 'idp',
        registrations: {
          bryan: {
            iss: 'https://bryan.example',
            sub: 'cached-id',
            registeredAt: '2026-06-25T08:00:00.000Z',
          },
        },
      },
      instanceSlug: 'bryan',
      instanceSigned: false,
    }

    await expect(
      resolveSelfIdLazy(
        ctx,
        {},
        {
          whoami: async () => {
            throw new Error('network down')
          },
        },
      ),
    ).resolves.toBe('cached-id')
  })

  test('does not run whoami for key-backed registrations', async () => {
    const ctx: SelfResolverContext = {
      identity: {
        name: 'alice',
        subject: 'alice',
        createdAt: '2026-06-25T08:00:00.000Z',
        source: 'key',
        registrations: {
          bryan: {
            iss: 'https://bryan.example',
            sub: 'key-node-id',
            registeredAt: '2026-06-25T08:00:00.000Z',
          },
        },
      },
      instanceSlug: 'bryan',
      instanceSigned: false,
    }
    let called = false

    const id = await resolveSelfIdLazy(
      ctx,
      {},
      {
        whoami: async () => {
          called = true
          return { id: 'should-not-be-used', kernelUrl: 'https://bryan.example' }
        },
      },
    )

    expect(id).toBe('key-node-id')
    expect(called).toBe(false)
  })
})
