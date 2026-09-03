import { ResponseError } from '@astrale-os/sdk/client'
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { provisionInstance } from '../provision-instance'

const originalError = console.error

afterEach(() => {
  console.error = originalError
})

describe('managed Instance root import during provisioning', () => {
  test('uses the exact created Instance and does not fail creation when root recovery fails', async () => {
    const created = {
      id: '@created-instance',
      slug: 'demo',
      url: 'https://demo.example.test/api',
      issuer: 'https://demo.example.test/api',
      state: 'ready' as const,
      organizationId: 'org_demo',
    }
    const createOwnedInstance = mock(async () => created)
    const upsertManagedBookmark = mock(async () => ({ entry: { url: created.url } }))
    const setActive = mock(async () => 'demo')
    const importFailure = new Error('retained material temporarily unavailable')
    const importInstanceRootIdentity = mock(async () => {
      throw importFailure
    })
    const warnings: string[] = []
    console.error = (...values: unknown[]) => warnings.push(values.map(String).join(' '))

    const result = await provisionInstance(
      'demo',
      { creds: 'admin-credential', ci: true },
      {
        createOwnedInstance,
        upsertManagedBookmark,
        setActive,
        importInstanceRootIdentity,
      },
    )

    expect(result.created).toBe(created)
    expect(result.rootIdentityError).toBe(importFailure)
    expect(importInstanceRootIdentity).toHaveBeenCalledTimes(1)
    expect(importInstanceRootIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ creds: 'admin-credential', timeout: '120000' }),
      created.id,
      { bookmark: false },
    )
    expect(upsertManagedBookmark).toHaveBeenCalledTimes(1)
    expect(upsertManagedBookmark).toHaveBeenCalledWith({
      key: 'demo',
      slug: 'demo',
      url: created.url,
      organizationId: created.organizationId,
    })
    expect(setActive).toHaveBeenCalledTimes(1)
    expect(setActive).toHaveBeenCalledWith('demo')
    expect(warnings.join('\n')).toContain('astrale instance root import demo')
  })

  test('replays one operation until the retained Instance becomes ready', async () => {
    const pending = {
      id: '@created-instance',
      slug: 'demo',
      operationId: 'cli.instance.create.fixed',
      url: '',
      state: 'provisioning' as const,
      phase: 'reserve-tenant',
    }
    const ready = {
      ...pending,
      url: 'https://demo.example.test/api',
      state: 'ready' as const,
      phase: 'ready',
    }
    const createOwnedInstance = mock()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, phase: 'install-shell-root' })
      .mockResolvedValueOnce(ready)
    const sleep = mock(async () => {})
    const upsertManagedBookmark = mock(async () => ({ entry: { url: ready.url } }))
    const setActive = mock(async () => 'demo')
    const importInstanceRootIdentity = mock(async () => ({ name: 'demo-root' }) as never)

    const result = await provisionInstance(
      'demo',
      { creds: 'admin-credential', ci: true },
      {
        createOwnedInstance,
        operationId: () => pending.operationId,
        now: () => 0,
        sleep,
        upsertManagedBookmark,
        setActive,
        importInstanceRootIdentity,
      },
    )

    expect(result.created).toEqual(ready)
    expect(createOwnedInstance).toHaveBeenCalledTimes(3)
    expect(createOwnedInstance.mock.calls).toEqual([
      [expect.objectContaining({ timeout: '120000' }), 'demo', pending.operationId],
      [expect.objectContaining({ timeout: '120000' }), 'demo', pending.operationId],
      [expect.objectContaining({ timeout: '120000' }), 'demo', pending.operationId],
    ])
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(upsertManagedBookmark).toHaveBeenCalledTimes(1)
    expect(importInstanceRootIdentity).toHaveBeenCalledTimes(1)
  })

  test('recovers a generic server failure by replaying the same operation', async () => {
    const ready = {
      id: '@created-instance',
      slug: 'demo',
      operationId: 'cli.instance.create.fixed',
      url: 'https://demo.example.test/api',
      state: 'ready' as const,
    }
    const createOwnedInstance = mock()
      .mockRejectedValueOnce(new ResponseError(5000, 'Internal failure.', 'request-1' as never))
      .mockResolvedValueOnce(ready)
    const sleep = mock(async () => {})

    const result = await provisionInstance(
      'demo',
      { creds: 'admin-credential', ci: true },
      {
        createOwnedInstance,
        operationId: () => ready.operationId,
        now: () => 0,
        sleep,
        upsertManagedBookmark: async () => ({ entry: { url: ready.url } }),
        setActive: async () => 'demo',
        importInstanceRootIdentity: async () => ({ name: 'demo-root' }) as never,
      },
    )

    expect(result.created).toEqual(ready)
    expect(createOwnedInstance).toHaveBeenCalledTimes(2)
    expect(createOwnedInstance.mock.calls[0]?.[2]).toBe(ready.operationId)
    expect(createOwnedInstance.mock.calls[1]?.[2]).toBe(ready.operationId)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  test('returns the nonterminal receipt without bookmarking when the recovery window ends', async () => {
    const pending = {
      id: '@created-instance',
      slug: 'demo',
      operationId: 'cli.instance.create.fixed',
      url: '',
      state: 'provisioning' as const,
      phase: 'create-host-child',
    }
    const createOwnedInstance = mock(async () => pending)
    const upsertManagedBookmark = mock()
    const setActive = mock()
    const importInstanceRootIdentity = mock()
    let now = 0

    const result = await provisionInstance(
      'demo',
      { creds: 'admin-credential', ci: true },
      {
        createOwnedInstance,
        operationId: () => pending.operationId,
        now: () => (now += 10 * 60_000),
        sleep: async () => {},
        upsertManagedBookmark,
        setActive,
        importInstanceRootIdentity,
      },
    )

    expect(result).toEqual({ created: pending, slug: 'demo' })
    expect(createOwnedInstance).toHaveBeenCalledTimes(1)
    expect(upsertManagedBookmark).not.toHaveBeenCalled()
    expect(setActive).not.toHaveBeenCalled()
    expect(importInstanceRootIdentity).not.toHaveBeenCalled()
  })
})
