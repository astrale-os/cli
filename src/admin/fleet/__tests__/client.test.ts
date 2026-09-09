import { describe, expect, it, mock } from 'bun:test'

import { AdminContract } from '../../contract'
import { resolveFleet, createFleet } from '../client'

const fleets = [
  {
    id: '@default-fleet',
    slug: 'default',
    name: 'Default',
    isDefault: true,
    canUse: true,
    canAdminister: true,
  },
  {
    id: '@private-fleet',
    slug: 'astrale',
    name: 'Astrale',
    isDefault: false,
    canUse: true,
    canAdminister: true,
  },
]
describe('Fleet selection', () => {
  it('keeps the historical default path without requiring the new directory endpoint', async () => {
    const call = mock(async () => {
      throw new Error('Old Admin has no directory')
    })
    expect((await resolveFleet({ session: { call } } as never)).raw).toBe(AdminContract.fleet.raw)
    expect(call).not.toHaveBeenCalled()
  })
  it('resolves explicit slugs and IDs, and refuses unavailable selections without falling back', async () => {
    const context = { session: { call: mock(async () => fleets) } } as never
    expect(String((await resolveFleet(context, 'astrale')).raw)).toBe('@private-fleet')
    expect(String((await resolveFleet(context, '@private-fleet')).raw)).toBe('@private-fleet')
    await expect(resolveFleet(context, 'unknown')).rejects.toThrow('unavailable')
  })
  it('sends the exact administrator, source and operation ID to the static creation method', async () => {
    const requests: unknown[] = []
    const context = {
      session: {
        call: mock(async (request: unknown) => {
          requests.push(request)
          return fleets[1]
        }),
      },
    } as never
    await createFleet(context, {
      operationId: 'create-astrale',
      slug: 'astrale',
      name: 'Astrale',
      administrator: '@admins',
      copyFrom: 'default',
    })
    expect(JSON.stringify(requests)).toContain('create-astrale')
    expect(JSON.stringify(requests)).toContain('@admins')
    expect(JSON.stringify(requests)).toContain('core.fleet')
  })
})
