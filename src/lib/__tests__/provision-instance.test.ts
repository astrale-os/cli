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
})
