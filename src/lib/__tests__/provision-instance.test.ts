import { ResponseError } from '@astrale-os/sdk/client'
import { invocation } from '@astrale-os/sdk/invocation'
import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { IdentityStore } from '../../identity/index'

import { AuthError } from '../../errors'
import { provisionInstance, selectInstanceCreateIdentity } from '../instance/provision'

const originalError = console.error
afterEach(() => {
  console.error = originalError
})

const OPERATION = 'cli.instance.create.fixed'
const ready = {
  id: '@created-instance',
  slug: 'demo',
  operationId: OPERATION,
  url: 'https://demo.example.test/api',
  state: 'ready' as const,
  organizationId: 'org_demo',
}
const pending = { ...ready, url: '', state: 'provisioning' as const, phase: 'reserve-tenant' }

const refusal = (code: number, reason?: { code: string; details: Record<string, string> }) =>
  new ResponseError(
    code as never,
    'Admin refused.',
    invocation.acceptInvocationId({ source: 'https://admin.example/api', id: 'request-1' }),
    reason,
  )

/** A provisioning journey whose every step succeeds unless a test replaces it. */
function journey(overrides: Partial<Parameters<typeof provisionInstance>[2]> = {}) {
  const events: string[] = []
  const dependencies = {
    createOwnedInstance: mock(async () => ready),
    operationId: mock(() => OPERATION),
    now: () => 0,
    sleep: mock(async () => {}),
    activateInstance: async () => {
      events.push('activate')
      return { status: 'completed' as const, user: 'owner' }
    },
    bookmarkCreatedInstance: mock(async () => {
      events.push('bookmark')
      return { name: 'demo', entry: { url: ready.url } }
    }),
    importInstanceRootIdentity: mock(async () => {
      events.push('root')
      return { name: 'demo-root' } as never
    }),
    ...overrides,
  }
  return { events, dependencies }
}

const provision = (opts: Partial<Parameters<typeof provisionInstance>[1]>, run = journey()) =>
  provisionInstance('demo', { creds: 'admin-credential', ci: true, ...opts }, run.dependencies)

describe('instance creation journey', () => {
  test('activates the owner, then bookmarks, then imports the root; a root failure is not fatal', async () => {
    const run = journey()
    const result = await provision({}, run)
    expect(run.events).toEqual(['activate', 'bookmark', 'root'])
    expect(result.access).toEqual({ status: 'completed', user: 'owner' })
    expect(run.dependencies.bookmarkCreatedInstance).toHaveBeenCalledWith({
      slug: 'demo',
      url: ready.url,
      organizationId: ready.organizationId,
    })
    expect(run.dependencies.importInstanceRootIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ creds: 'admin-credential', timeout: '120000' }),
      ready.id,
      { bookmark: false, replace: 'same-issuer' },
    )

    const warnings: string[] = []
    console.error = (...values: unknown[]) => void warnings.push(values.map(String).join(' '))
    const failure = new Error('retained material temporarily unavailable')
    const failing = journey({
      importInstanceRootIdentity: async () => {
        throw failure
      },
    })
    const recovered = await provision({}, failing)
    expect(recovered.created).toBe(ready)
    expect(recovered.rootIdentityError).toBe(failure)
    expect(warnings.join('\n')).toContain('astrale instance root import demo')
  })

  test('replays one operation in the Fleet it resolved, through server failures, until ready', async () => {
    const fleets: Array<string | undefined> = []
    const answers = [
      () => {
        throw refusal(5000)
      },
      () => pending,
      () => ready,
    ]
    const run = journey({
      createOwnedInstance: mock(async (opts, _slug, operationId, selected) => {
        fleets.push(opts.fleet)
        expect(operationId).toBe(OPERATION)
        selected?.('@shared')
        return answers.shift()!()
      }),
    })

    const result = await provision({}, run)

    expect(result.created).toEqual(ready)
    expect(fleets).toEqual([undefined, '@shared', '@shared'])
    expect(run.dependencies.sleep).toHaveBeenCalledTimes(2)
  })

  test('reuses an explicit operation and refuses a malformed one before contacting Admin', async () => {
    const create = mock(async () => ready)
    const run = journey({ createOwnedInstance: create })
    await provision({ operation: 'lab:instance.create.recovery-01' }, run)
    expect(run.dependencies.operationId).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      'demo',
      'lab:instance.create.recovery-01',
      expect.any(Function),
    )

    for (const operation of ['contains spaces', '-leading', `a${'b'.repeat(256)}`]) {
      const refused = journey()
      await expect(provision({ operation }, refused)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
      expect(refused.dependencies.createOwnedInstance).not.toHaveBeenCalled()
    }
  })

  test('stops at a declared refusal of the failed operation and points at a new one', async () => {
    const capacity = journey({
      createOwnedInstance: mock(async () => {
        throw refusal(4001, {
          code: 'INSTANCE_CAPACITY_UNAVAILABLE',
          details: { fleet: '@astrale-fleet' },
        })
      }),
    })
    await expect(provision({ fleet: '@astrale-fleet' }, capacity)).rejects.toMatchObject({
      code: 'INSTANCE_CAPACITY_UNAVAILABLE',
      hint: `A Fleet administrator provisions a Host first: astrale call "@astrale-fleet::admin.astrale.ai:class.Fleet.method.provisionHost" --admin -d '{"operationId":"<new-id>","id":"<host-id>","provider":{"kind":"scaleway"}}'. Then rerun \`astrale instance create demo --fleet '@astrale-fleet'\` without --operation.`,
    })
    expect(capacity.dependencies.createOwnedInstance).toHaveBeenCalledTimes(1)
    expect(capacity.dependencies.sleep).not.toHaveBeenCalled()

    const conflict = journey({
      createOwnedInstance: mock(async () => {
        throw refusal(4001, {
          code: 'OPERATION_CONFLICT',
          details: { reason: 'Instance route publication was refused.' },
        })
      }),
    })
    await expect(provision({ operation: 'lab.failed' }, conflict)).rejects.toMatchObject({
      code: 'OPERATION_CONFLICT',
      message:
        'Creation operation lab.failed cannot continue: Instance route publication was refused.',
    })
  })

  test('returns a still-provisioning receipt without bookmarking when the window ends', async () => {
    let now = 0
    const run = journey({
      createOwnedInstance: mock(async () => pending),
      now: () => (now += 10 * 60_000),
    })
    expect(await provision({}, run)).toEqual({ created: pending, slug: 'demo' })
    expect(run.events).toEqual([])
  })

  test('creates only as a WorkOS identity, the selected one or the default', () => {
    const identity = (source: 'key' | 'idp') => ({
      subject: source,
      createdAt: '2026-06-08T00:00:00.000Z',
      source,
    })
    const store: IdentityStore = {
      default: 'local',
      identities: { local: identity('key'), workos: identity('idp') },
    }
    expect(() => selectInstanceCreateIdentity(store)).toThrow(AuthError)
    expect(selectInstanceCreateIdentity(store, { as: 'workos' })).toBe('workos')
  })
})
