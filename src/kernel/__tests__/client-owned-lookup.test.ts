import { describe, expect, mock, test } from 'bun:test'

import type { OwnedInstanceInfo } from '../../lib/admin-instance'
import type { AdminTargetCommandOpts } from '../../lib/admin-target'
import type { KernelCommandOpts } from '../types'

import { lookupImplicitOwnedInstance } from '../client'

describe('implicit managed target owner discovery', () => {
  test('keeps target credentials out of the admin inventory lookup', async () => {
    const owned: OwnedInstanceInfo = {
      id: 'owned-id',
      slug: 'owned',
      url: 'https://owned.eu.astrale.ai',
      state: 'ready',
    }
    let captured:
      | {
          slug: string
          opts: KernelCommandOpts & AdminTargetCommandOpts
        }
      | undefined
    const lookupOwned = mock(
      async (slug: string, opts: KernelCommandOpts & AdminTargetCommandOpts) => {
        captured = { slug, opts }
        return owned
      },
    )

    await lookupImplicitOwnedInstance(
      'owned',
      {
        as: 'target-identity',
        creds: 'target-delegation',
        timeout: '45000',
        debug: true,
      },
      { lookupOwned },
    )

    expect(captured).toEqual({
      slug: 'owned',
      opts: {
        timeout: '45000',
        debug: true,
      },
    })
    expect(captured?.opts).not.toHaveProperty('as')
    expect(captured?.opts).not.toHaveProperty('creds')
  })
})
