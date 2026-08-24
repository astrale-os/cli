import { describe, expect, mock, test } from 'bun:test'

import type { OwnedInstanceInfo } from '../../lib/admin-instance'
import type { SetupContext } from '../types'

import { AstraleError } from '../../errors'
import {
  adoptOwnedInstance,
  ensureOwnedInstance,
  type InstanceSetupDependencies,
} from '../steps/instance'

const ctx: SetupContext = {
  interactive: true,
  machine: true,
  opts: {},
  slug: 'new-instance',
}

function instance(slug: string, state: OwnedInstanceInfo['state'] = 'ready'): OwnedInstanceInfo {
  return {
    id: `${slug}-id`,
    slug,
    url: `https://${slug}.eu.astrale.ai`,
    state,
    organizationId: `org_${slug}`,
  }
}

function inventory(instances: OwnedInstanceInfo[], identity?: string) {
  return { instances, ...(identity ? { identity } : {}) }
}

function dependencies(
  overrides: Partial<InstanceSetupDependencies> = {},
): InstanceSetupDependencies {
  return {
    fetchOwned: mock(async () => inventory([])),
    adopt: mock(async () => {}),
    selectReady: mock(async (instances) => instances[0] ?? null),
    confirmCreate: mock(async () => true),
    promptSlug: mock(async () => 'new-instance'),
    provision: mock(async (slug) => ({
      created: { url: `https://${slug}.eu.astrale.ai`, organizationId: `org_${slug}` },
      slug,
    })),
    ...overrides,
  }
}

describe('setup owned-instance reconciliation', () => {
  test('silently adopts the sole owned ready instance', async () => {
    const ready = instance('only')
    const failed = instance('old-attempt', 'failed')
    const deps = dependencies({
      fetchOwned: mock(async () => inventory([failed, ready], 'manager')),
    })

    await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('fixed')

    expect(deps.adopt).toHaveBeenCalledTimes(1)
    expect(deps.adopt).toHaveBeenCalledWith(ready, 'manager')
    expect(deps.selectReady).not.toHaveBeenCalled()
    expect(deps.confirmCreate).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
  })

  test('asks the user to pick when several owned instances are ready', async () => {
    const first = instance('first')
    const second = instance('second')
    const pending = instance('pending', 'provisioning')
    const deps = dependencies({
      fetchOwned: mock(async () => inventory([first, pending, second], 'manager')),
      selectReady: mock(async (instances) => instances[1] ?? null),
    })

    await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('fixed')

    expect(deps.selectReady).toHaveBeenCalledWith([first, second])
    expect(deps.adopt).toHaveBeenCalledWith(second, 'manager')
    expect(deps.confirmCreate).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
  })

  test('leaves setup skipped when the ready-instance picker is cancelled', async () => {
    const first = instance('first')
    const second = instance('second')
    const deps = dependencies({
      fetchOwned: mock(async () => inventory([first, second])),
      selectReady: mock(async () => null),
    })

    await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('skipped')

    expect(deps.selectReady).toHaveBeenCalledWith([first, second])
    expect(deps.adopt).not.toHaveBeenCalled()
    expect(deps.confirmCreate).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
  })

  test('offers first-instance creation only after a confirmed empty owner list', async () => {
    const deps = dependencies()
    const original = console.log
    console.log = mock(() => {})

    try {
      await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('fixed')
    } finally {
      console.log = original
    }

    expect(deps.confirmCreate).toHaveBeenCalledTimes(1)
    expect(deps.promptSlug).toHaveBeenCalledTimes(1)
    expect(deps.provision).toHaveBeenCalledWith('new-instance')
    expect(deps.adopt).not.toHaveBeenCalled()
  })

  test('does not provision when first-instance creation is declined', async () => {
    const deps = dependencies({ confirmCreate: mock(async () => false) })

    await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('skipped')

    expect(deps.confirmCreate).toHaveBeenCalledTimes(1)
    expect(deps.promptSlug).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
  })

  test('does not provision when the slug prompt is cancelled', async () => {
    const deps = dependencies({ promptSlug: mock(async () => undefined) })

    await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('skipped')

    expect(deps.confirmCreate).toHaveBeenCalledTimes(1)
    expect(deps.promptSlug).toHaveBeenCalledTimes(1)
    expect(deps.provision).not.toHaveBeenCalled()
  })

  test('does not report setup fixed when provisioning could not select the instance', async () => {
    const deps = dependencies({
      provision: mock(async (slug) => ({
        created: { url: `https://${slug}.eu.astrale.ai`, organizationId: `org_${slug}` },
        slug,
        selectionError: new Error('instances.json is read-only'),
      })),
    })
    const logged: string[] = []
    const original = console.log
    console.log = mock((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })

    let caught: unknown
    try {
      await ensureOwnedInstance(ctx, deps)
    } catch (error) {
      caught = error
    } finally {
      console.log = original
    }

    expect(caught).toBeInstanceOf(AstraleError)
    expect((caught as AstraleError).code).toBe('INSTANCE_SELECTION_FAILED')
    expect((caught as AstraleError).message).toContain('instances.json is read-only')
    expect((caught as AstraleError).hint).toContain('astrale instance use new-instance')
    expect(logged.join('\n')).not.toContain('https://new-instance.eu.astrale.ai')
  })

  test('does not create a duplicate while an owned instance is provisioning or failed', async () => {
    const provisioning = {
      ...instance('pending', 'provisioning'),
      phase: 'installing:default-domains',
    }
    const failed = { ...instance('broken', 'failed'), error: 'postInstall failed' }
    const deps = dependencies({
      fetchOwned: mock(async () => inventory([provisioning, failed])),
    })
    const logged: string[] = []
    const original = console.log
    console.log = mock((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })

    try {
      await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('skipped')
    } finally {
      console.log = original
    }

    expect(deps.selectReady).not.toHaveBeenCalled()
    expect(deps.confirmCreate).not.toHaveBeenCalled()
    expect(deps.promptSlug).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
    expect(logged.join('\n')).toContain('pending: provisioning (installing:default-domains)')
    expect(logged.join('\n')).toContain('broken: failed')
    expect(logged.join('\n')).toContain('postInstall failed')
    expect(logged.join('\n')).toContain('astrale instance status')
  })

  test('does not treat owner-discovery failure as an empty account', async () => {
    const deps = dependencies({
      fetchOwned: mock(async () => {
        throw new Error('admin unavailable')
      }),
    })

    let caught: unknown
    try {
      await ensureOwnedInstance(ctx, deps)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(AstraleError)
    expect((caught as AstraleError).code).toBe('INSTANCE_DISCOVERY_FAILED')
    expect((caught as AstraleError).hint).toContain('No instance was created')
    expect(deps.confirmCreate).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
  })
})

describe('owned-instance adoption', () => {
  test('persists the owner organization before activating the bookmark', async () => {
    const owned = instance('existing')
    const calls: unknown[][] = []
    const original = console.log
    console.log = mock(() => {})

    try {
      await adoptOwnedInstance(owned, 'manager', {
        upsert: mock(async (...args) => {
          calls.push(['upsert', ...args])
          return { entry: {} }
        }),
        activate: mock(async (...args) => {
          calls.push(['activate', ...args])
        }),
      })
    } finally {
      console.log = original
    }

    expect(calls).toEqual([
      [
        'upsert',
        {
          key: 'existing',
          slug: 'existing',
          url: 'https://existing.eu.astrale.ai',
          organizationId: 'org_existing',
          defaultIdentity: 'manager',
        },
      ],
      ['activate', 'existing'],
    ])
  })
})
