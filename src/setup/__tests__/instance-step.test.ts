import { describe, expect, mock, test } from 'bun:test'

import type { InstanceInfo } from '../../admin/instance'
import type { SetupContext } from '../types'

import { human } from '../../commands/__tests__/fixtures/process'
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

function instance(slug: string, state: InstanceInfo['state'] = 'ready'): InstanceInfo {
  return {
    id: `${slug}-id`,
    slug,
    url: `https://${slug}.eu.astrale.ai`,
    state,
    organizationId: `org_${slug}`,
  }
}

function inventory(instances: InstanceInfo[], identity?: string) {
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
      created: instance(slug),
      slug,
      access: { status: 'completed' as const, user: 'owner' },
    })),
    ...overrides,
  }
}

const owned = (instances: InstanceInfo[]) => mock(async () => inventory(instances, 'manager'))
const provisioned = (rest: object) =>
  mock(async (slug: string) => ({ created: instance(slug), slug, ...rest }))

describe('setup owned-instance reconciliation', () => {
  test('adopts the sole ready instance silently, else the one the user picks', async () => {
    const ready = instance('only')
    const sole = dependencies({ fetchOwned: owned([instance('old', 'failed'), ready]) })
    await expect(ensureOwnedInstance(ctx, sole)).resolves.toBe('fixed')
    expect(sole.adopt).toHaveBeenCalledWith(ready, 'manager')
    expect(sole.selectReady).not.toHaveBeenCalled()

    const [first, second] = [instance('first'), instance('second')]
    const several = dependencies({
      fetchOwned: owned([first, instance('pending', 'provisioning'), second]),
      selectReady: mock(async (instances) => instances[1] ?? null),
    })
    await expect(ensureOwnedInstance(ctx, several)).resolves.toBe('fixed')
    expect(several.selectReady).toHaveBeenCalledWith([first, second])
    expect(several.adopt).toHaveBeenCalledWith(second, 'manager')
    for (const deps of [sole, several]) expect(deps.provision).not.toHaveBeenCalled()
  })

  test('offers first-instance creation only after a confirmed empty owner list', async () => {
    const deps = dependencies()
    await human(async () => await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('fixed'))
    expect(deps.provision).toHaveBeenCalledWith('new-instance')
    expect(deps.adopt).not.toHaveBeenCalled()
  })

  test.each([
    [
      'the picker is cancelled',
      { fetchOwned: owned([instance('a'), instance('b')]), selectReady: mock(async () => null) },
    ],
    ['creation is declined', { confirmCreate: mock(async () => false) }],
    ['the slug prompt is cancelled', { promptSlug: mock(async () => undefined) }],
    [
      'owner access is pending',
      {
        provision: provisioned({
          access: { status: 'pending', code: 'OWNER_ACTIVATION_UNAVAILABLE' },
        }),
      },
    ],
    [
      'creation returns a resumable receipt',
      {
        provision: mock(async (slug: string) => ({
          created: { ...instance(slug, 'provisioning'), url: '' },
          slug,
        })),
      },
    ],
  ] as const)('stays skipped when %s', async (_name, overrides) => {
    const deps = dependencies(overrides as Partial<InstanceSetupDependencies>)
    const warn = console.warn
    console.warn = () => undefined
    try {
      await human(async () => await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('skipped'))
    } finally {
      console.warn = warn
    }
    expect(deps.adopt).not.toHaveBeenCalled()
  })

  test('does not create a duplicate while an owned instance is provisioning or failed', async () => {
    const provisioning = {
      ...instance('pending', 'provisioning'),
      phase: 'installing:default-domains',
    }
    const failed = { ...instance('broken', 'failed'), error: 'postInstall failed' }
    const deps = dependencies({ fetchOwned: owned([provisioning, failed]) })

    const shown = await human(
      async () => await expect(ensureOwnedInstance(ctx, deps)).resolves.toBe('skipped'),
    )

    expect(deps.confirmCreate).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
    for (const line of [
      'pending: provisioning (installing:default-domains)',
      'broken: failed',
      'postInstall failed',
      'astrale instance status',
    ])
      expect(shown.lines).toContain(line)
  })

  test('fails, never reports fixed, when discovery or the bookmark fails', async () => {
    const unreachable = dependencies({
      fetchOwned: mock(async () => {
        throw new Error('admin unavailable')
      }),
    })
    await expect(ensureOwnedInstance(ctx, unreachable)).rejects.toMatchObject({
      code: 'INSTANCE_DISCOVERY_FAILED',
      hint: expect.stringContaining('No instance was created'),
    })
    expect(unreachable.provision).not.toHaveBeenCalled()

    const unbookmarked = dependencies({
      provision: provisioned({
        bookmark: {
          status: 'pending',
          code: 'INSTANCE_BOOKMARK_FAILED',
          message: 'Instance is ready, but instances.json is read-only',
          hint: 'Fix local CLI storage, then replay instance create',
        },
      }),
    })
    const shown = await human(
      async () =>
        await expect(ensureOwnedInstance(ctx, unbookmarked)).rejects.toMatchObject({
          code: 'INSTANCE_BOOKMARK_FAILED',
          hint: expect.stringContaining('replay instance create'),
        }),
    )
    expect(shown.lines).not.toContain('https://new-instance.eu.astrale.ai')
  })
})

describe('owned-instance adoption', () => {
  test('persists the owner organization before activating the bookmark', async () => {
    const calls: unknown[][] = []
    await human(() =>
      adoptOwnedInstance(instance('existing'), 'manager', {
        upsert: mock(async (...args) => {
          calls.push(['upsert', ...args])
          return { entry: {} }
        }),
        activate: mock(async (...args) => {
          calls.push(['activate', ...args])
        }),
      }),
    )

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
