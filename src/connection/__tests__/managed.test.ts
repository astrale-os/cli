import { expect, spyOn, test } from 'bun:test'

import type { DirectoryReadOptions, InstanceDirectory } from '../../lib/admin/directory'
import type { DirectoryRead } from '../../lib/admin/directory-cache'

import { lookupManagedInstance } from '../session'

const PACE = {
  organizationId: 'org_01PACE',
  name: 'Pace',
  url: 'https://pace.eu.astrale.ai',
  slug: 'pace',
  region: 'eu',
}

type Mode = 'refresh' | 'prefer-fresh'

const reading =
  (
    directory: InstanceDirectory,
    seen: DirectoryReadOptions[] = [],
    extra: Omit<DirectoryRead, 'directory'> = {},
  ) =>
  async (options: DirectoryReadOptions = {}): Promise<DirectoryRead> => (
    seen.push(options),
    { directory, ...extra }
  )

test('implicit managed target discovery keeps target credentials out of the directory read', async () => {
  const seen: DirectoryReadOptions[] = []
  const target = { as: 'target-identity', creds: 'target-delegation', timeout: '45000' }

  await expect(
    lookupManagedInstance('pace', target, reading({ instances: [PACE], truncated: false }, seen)),
  ).resolves.toEqual({ slug: 'pace', url: 'https://pace.eu.astrale.ai' })
  expect(seen).toEqual([{ timeout: '45000' }])
})

test('an unknown slug is not found, and a slug held twice is refused', async () => {
  const twice = {
    instances: [PACE, { ...PACE, organizationId: 'org_02', url: 'https://pace.us.astrale.ai' }],
    truncated: false,
  }
  await expect(
    lookupManagedInstance('other', {}, reading({ instances: [PACE], truncated: false })),
  ).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
  await expect(lookupManagedInstance('pace', {}, reading(twice))).rejects.toMatchObject({
    code: 'INSTANCE_AMBIGUOUS',
  })
})

test('a recent listing answers first; a slug missing from it asks the directory once', async () => {
  const modes: Mode[] = []
  const fresh = { instances: [PACE], truncated: false }
  const created = { ...PACE, slug: 'new', url: 'https://new.eu.astrale.ai' }
  const read = async (_options: DirectoryReadOptions, mode: Mode): Promise<DirectoryRead> => {
    modes.push(mode)
    return mode === 'prefer-fresh'
      ? { directory: fresh, cached: true }
      : { directory: { instances: [PACE, created], truncated: false } }
  }
  await expect(lookupManagedInstance('pace', {}, read)).resolves.toMatchObject({ slug: 'pace' })
  expect(modes).toEqual(['prefer-fresh'])
  modes.length = 0
  await expect(lookupManagedInstance('new', {}, read)).resolves.toMatchObject({ slug: 'new' })
  expect(modes).toEqual(['prefer-fresh', 'refresh'])
})

test('the last listing answers while the directory is down, with a warning giving its age', async () => {
  const warn = spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const listedAt = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
    await expect(
      lookupManagedInstance(
        'pace',
        {},
        reading({ instances: [PACE], truncated: false }, [], {
          stale: {
            listedAt,
            code: 'DIRECTORY_UNAVAILABLE',
            message: 'The instance directory answered HTTP 503.',
          },
        }),
      ),
    ).resolves.toMatchObject({ slug: 'pace' })
    const printed = warn.mock.calls.flat().join(' ')
    expect(printed).toContain('HTTP 503')
    expect(printed).toContain('3 h ago')
  } finally {
    warn.mockRestore()
  }
})
