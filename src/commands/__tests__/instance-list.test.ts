import { ResponseError } from '@astrale-os/sdk/client'
import { describe, expect, test } from 'bun:test'

import type { InstanceInfo } from '../../admin/instance'

import { AstraleError } from '../../errors'
import {
  buildDirectoryRows,
  buildInstanceRows,
  classifyAdminInventoryError,
  listDirectory,
  needsAdminInventory,
  readAdminInventory,
  type Bookmark,
} from '../instance/list'

const INVOCATION = {
  source: 'https://admin.test',
  id: 'instance-list',
} as ConstructorParameters<typeof ResponseError>[2]

describe('instance rows', () => {
  const managed: InstanceInfo[] = [
    { id: 'demo', slug: 'demo', url: 'https://demo.eu.astrale.ai', state: 'ready' },
  ]
  const bookmark = (overrides: Partial<Bookmark> = {}): Bookmark => ({
    name: 'demo',
    url: 'https://demo.eu.astrale.ai/api',
    issuer: null,
    active: false,
    defaultIdentity: null,
    caFile: null,
    createdAt: null,
    ...overrides,
  })
  const both = { managed: true, bookmarks: true }

  test('a bookmark of a managed instance merges into its row, active marker included', () => {
    const merged = buildInstanceRows(managed, [bookmark({ active: true })], both)
    expect(merged).toEqual([expect.objectContaining({ kind: 'managed', name: 'demo *' })])

    const local = bookmark({ name: 'local', url: 'http://localhost:3001/api' })
    const elsewhere = bookmark({ url: 'https://elsewhere.example.com' })
    expect(buildInstanceRows(managed, [elsewhere, local], both).map(({ kind }) => kind)).toEqual([
      'managed',
      'bookmark',
      'bookmark',
    ])
    // --bookmarked hides managed instances: nothing merges.
    expect(
      buildInstanceRows(managed, [bookmark()], { managed: false, bookmarks: true }),
    ).toMatchObject([{ kind: 'bookmark' }])
  })

  test('an explicitly included retired Instance renders through the ordinary row shape', () => {
    const retired = {
      id: '@retired',
      slug: 'retired',
      url: '',
      issuer: 'https://retired.example.test/kernel/host',
      state: 'deleted' as const,
    }
    expect(buildInstanceRows([retired], [], { managed: true, bookmarks: false })).toEqual([
      { name: 'retired', kind: 'managed', url: '', extra: 'deleted' },
    ])
  })
})

describe('Admin inventory failures', () => {
  test.each([
    ['TOKEN_EXCHANGE_SOURCE_INVALID', 'instance list --bookmarked'],
    ['ADMIN_DOMAIN_ISSUER_MISSING', 'Key-backed identities cannot mint an Admin Domain token'],
  ])('%s becomes a bookmark-only instruction', (code, hint) => {
    expect(classifyAdminInventoryError(new AstraleError(code, 'refused'))).toMatchObject({
      code: 'ADMIN_INVENTORY_UNAVAILABLE',
      hint: expect.stringContaining(hint),
    })
  })

  test('backs off through a bounded window of backend failures, never retrying a refusal', async () => {
    const delays: number[] = []
    const sleep = async (milliseconds: number) => void delays.push(milliseconds)
    const failing = (cause: Error, until = Infinity) => {
      let attempts = 0
      return Object.assign(
        async () => {
          if (++attempts < until) throw cause
          return ['bryan']
        },
        { attempts: () => attempts },
      )
    }
    const unavailable = new ResponseError(5001, 'Authentication is unavailable.', INVOCATION)

    const recovering = failing(unavailable, 4)
    expect(
      await readAdminInventory(recovering, { retryDelaysMs: [10, 30, 90, 170], sleep }),
    ).toEqual(['bryan'])
    expect(delays.splice(0)).toEqual([10, 30, 90])

    const down = failing(unavailable)
    await expect(readAdminInventory(down, { sleep })).rejects.toBe(unavailable)
    expect(down.attempts()).toBe(5)
    expect(delays.splice(0)).toEqual([100, 300, 900, 1_700])
    expect(classifyAdminInventoryError(unavailable)).toMatchObject({
      code: 'ADMIN_BACKEND_UNAVAILABLE',
      message: 'Authentication is unavailable.',
      hint: expect.stringContaining('Retry later'),
    })

    const denied = failing(new ResponseError(2004, 'Access denied.', INVOCATION))
    await expect(readAdminInventory(denied, { sleep })).rejects.toThrow('Access denied.')
    expect(denied.attempts()).toBe(1)
    expect(delays).toEqual([])

    // The Session's transport already resent a refusal with a retry delay until its deadline.
    const draining = failing(
      new ResponseError(5001, 'Instance is unavailable; retry later.', INVOCATION, {
        code: 'SERVER_DRAINING',
        details: { retryAfterMs: 1_000 },
      }),
    )
    await expect(readAdminInventory(draining, { sleep })).rejects.toThrow('retry later')
    expect(draining.attempts()).toBe(1)
    expect(delays).toEqual([])
  })
})

describe('directory rows', () => {
  const pace = {
    organizationId: 'org_01PACE',
    name: 'Pace Logistique',
    url: 'https://pace.eu.astrale.ai',
    slug: 'pace',
    region: 'eu',
  }
  const bookmark = (overrides: Partial<Bookmark> = {}): Bookmark => ({
    name: 'pace',
    url: 'https://pace.eu.astrale.ai/api',
    issuer: null,
    active: false,
    defaultIdentity: null,
    caFile: null,
    createdAt: null,
    ...overrides,
  })

  test('a bookmark of a directory instance merges into its row, under its own name when it differs', () => {
    expect(buildDirectoryRows([pace], [bookmark({ name: 'work', active: true })])).toEqual([
      {
        name: expect.stringMatching(/^pace \(bookmark work\) .*\*/u),
        region: 'eu',
        url: 'https://pace.eu.astrale.ai',
        organization: 'Pace Logistique',
        source: 'workos',
      },
    ])
    const local = bookmark({ name: 'local', url: 'http://localhost:3001/api' })
    expect(
      buildDirectoryRows([pace], [bookmark(), local]).map(({ name, source }) => [name, source]),
    ).toEqual([
      ['pace', 'workos'],
      ['local', 'bookmark'],
    ])
  })

  test('only operator options read the Admin inventory', () => {
    expect(needsAdminInventory({})).toBe(false)
    expect(needsAdminInventory({ adminOnly: true })).toBe(true)
    expect(needsAdminInventory({ fleet: '@fleet' })).toBe(true)
    expect(needsAdminInventory({ includeRetired: true })).toBe(true)
  })

  test('a failed directory still lists bookmarks, and says why in machine output', async () => {
    const written: string[] = []
    const write = process.stdout.write
    process.stdout.write = ((chunk: string) => (written.push(chunk), true)) as typeof write
    try {
      await listDirectory({ json: true }, 'local', [bookmark({ name: 'local' })], async () => {
        throw new AstraleError('DIRECTORY_UNAVAILABLE', 'The instance directory answered HTTP 503.')
      })
    } finally {
      process.stdout.write = write
    }
    expect(JSON.parse(written.join(''))).toMatchObject({
      active: 'local',
      bookmarks: [{ name: 'local' }],
      instances: [],
      directory: { status: 'unavailable', code: 'DIRECTORY_UNAVAILABLE' },
    })
    // Nothing to fall back to: the failure is the result.
    await expect(
      listDirectory({ json: true }, null, [], async () => {
        throw new AstraleError('DIRECTORY_RATE_LIMITED', 'Too many reads.')
      }),
    ).rejects.toMatchObject({ code: 'DIRECTORY_RATE_LIMITED' })
  })
})

describe('instance list while the directory is down', () => {
  test('shows the last known listing, and says when it was read', async () => {
    const pace = {
      organizationId: 'org_01PACE',
      name: 'Pace',
      url: 'https://pace.eu.astrale.ai',
      slug: 'pace',
      region: 'eu',
    }
    const written: string[] = []
    const write = process.stdout.write
    process.stdout.write = ((chunk: string) => (written.push(chunk), true)) as typeof write
    try {
      await listDirectory({ json: true }, null, [], async (_options, mode) => {
        // `instance list` always asks the directory; the last listing only stands in.
        expect(mode).toBe('refresh')
        return {
          directory: { instances: [pace], truncated: false },
          stale: {
            listedAt: '2026-11-06T12:00:00.000Z',
            code: 'DIRECTORY_UNAVAILABLE',
            message: 'The instance directory answered HTTP 503.',
          },
        }
      })
    } finally {
      process.stdout.write = write
    }
    expect(JSON.parse(written.join(''))).toMatchObject({
      instances: [pace],
      directory: {
        status: 'stale',
        listedAt: '2026-11-06T12:00:00.000Z',
        code: 'DIRECTORY_UNAVAILABLE',
      },
    })
  })
})
