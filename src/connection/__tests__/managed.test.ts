import { expect, test } from 'bun:test'

import type { DirectoryReadOptions, InstanceDirectory } from '../../lib/admin/directory'

import { lookupManagedInstance } from '../session'

const PACE = {
  organizationId: 'org_01PACE',
  name: 'Pace',
  url: 'https://pace.eu.astrale.ai',
  slug: 'pace',
  region: 'eu',
}

const reading =
  (directory: InstanceDirectory, seen: DirectoryReadOptions[] = []) =>
  async (options: DirectoryReadOptions = {}) => (seen.push(options), directory)

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
