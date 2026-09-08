import { ResponseError } from '@astrale-os/sdk/client'
import { invocation } from '@astrale-os/sdk/invocation'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { provisionInstance } from '../provision-instance'

const originalError = console.error
const temporary: string[] = []

afterEach(async () => {
  console.error = originalError
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('managed Instance root import during provisioning', () => {
  test('stops a rejected creation receipt before activation, bookmark or Root recovery', async () => {
    const refused = new ResponseError(
      4001,
      'Creation receipt actor mismatch.',
      invocation.acceptInvocationId({ source: 'https://admin.example/api', id: 'receipt-attempt' }),
    )
    const createOwnedInstance = mock(async () => {
      throw refused
    })
    const upsertManagedBookmark = mock()
    const setActive = mock()
    const activateInstance = mock()
    const importInstanceRootIdentity = mock()
    await expect(
      provisionInstance(
        'demo',
        { creds: 'caller-proof', ci: true },
        {
          createOwnedInstance,
          upsertManagedBookmark,
          setActive,
          activateInstance,
          importInstanceRootIdentity,
        },
      ),
    ).rejects.toBe(refused)
    expect(createOwnedInstance).toHaveBeenCalledTimes(1)
    for (const effect of [
      upsertManagedBookmark,
      setActive,
      activateInstance,
      importInstanceRootIdentity,
    ]) {
      expect(effect).not.toHaveBeenCalled()
    }
  })
  test('confirms human activation before selecting the instance, independently of Root import', async () => {
    const events: string[] = []
    const created = {
      id: '@instance',
      slug: 'demo',
      url: 'https://demo.example/api',
      state: 'ready' as const,
    }
    const result = await provisionInstance(
      'demo',
      { creds: 'admin-credential', ci: true },
      {
        createOwnedInstance: async () => created,
        upsertManagedBookmark: async () => {
          events.push('bookmark')
          return { entry: { url: created.url } }
        },
        activateInstance: async (instance) => {
          expect(instance).toBe(created)
          events.push('activate')
          return { status: 'completed', user: 'owner' }
        },
        setActive: async () => {
          events.push('select')
          return 'demo'
        },
        importInstanceRootIdentity: async () => {
          events.push('root')
          return { name: 'demo-root' } as never
        },
      },
    )
    expect(events).toEqual(['activate', 'bookmark', 'select', 'root'])
    expect(result.access).toEqual({ status: 'completed', user: 'owner' })
  })

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
        activateInstance: async () => ({ status: 'completed', user: 'owner' }),
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
      activateWhenEmpty: false,
    })
    expect(setActive).toHaveBeenCalledTimes(1)
    expect(result.access).toEqual({ status: 'completed', user: 'owner' })
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
        activateInstance: async () => ({ status: 'completed', user: 'owner' }),
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
      .mockRejectedValueOnce(
        new ResponseError(
          5000,
          'Internal failure.',
          invocation.acceptInvocationId({ source: 'https://admin.example/api', id: 'request-1' }),
        ),
      )
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
        activateInstance: async () => ({ status: 'completed', user: 'owner' }),
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

  test.each(['empty', 'same-name-active'] as const)(
    'keeps %s local selection intact on interrupted access and resumes the same receipt in a fresh process',
    async (initial) => {
      const directory = await mkdtemp(join(tmpdir(), 'astrale-create-access-'))
      temporary.push(directory)
      const path = join(directory, 'instances.json')
      const store =
        initial === 'empty'
          ? { active: '', instances: {} }
          : {
              active: 'demo',
              instances: {
                demo: {
                  url: 'https://old.example/api',
                  issuer: 'https://old.example/api',
                  kind: 'bookmark',
                },
              },
            }
      const original = JSON.stringify(store)
      await writeFile(path, original)
      const module = new URL('../provision-instance.ts', import.meta.url).href
      const plans = new URL('../admin-instance.ts', import.meta.url).href
      const activation = new URL('../activate-instance.ts', import.meta.url).href
      const source = `
      import assert from 'node:assert/strict';
      import { provisionInstance } from ${JSON.stringify(module)};
      import { planInstanceCreate } from ${JSON.stringify(plans)};
      import { activateOwner } from ${JSON.stringify(activation)};
      const instance = { id: '@retained-instance', slug: 'demo', operationId: 'retained-operation',
        state: 'ready', url: 'https://new.example/api', organizationId: 'org_child' };
      const result = await provisionInstance('demo', { creds: 'test-admin', ci: true }, {
        createOwnedInstance: async (_options, slug, freshOperation) => {
          assert.equal(planInstanceCreate([instance], slug, freshOperation).operationId, instance.operationId);
          return instance;
        },
        activateInstance: async () => activateOwner({ endpoint: 'https://admin.example/v1/owner-activation',
          instanceOrigin: 'https://new.example', credential: async () => 'test-child',
          whoami: async () => 'reserved-owner' }, { fetch: async () => {
            if (process.env.CASE_PHASE === 'lost') throw new Error('response lost');
            return Response.json({status:'completed', user:'reserved-owner'});
          } }),
        importInstanceRootIdentity: async () => { throw new Error('optional Root import unavailable'); },
      });
      process.stdout.write(JSON.stringify({id:result.created.id, operation:result.created.operationId,
        access:result.access, selectionError:result.selectionError !== undefined}));
    `
      const run = async (phase: string) => {
        const child = Bun.spawn([process.execPath, '--eval', source], {
          env: { ...process.env, ASTRALE_HOME: directory, CASE_PHASE: phase },
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(code).toBe(0)
        return { result: JSON.parse(stdout), stderr }
      }
      const interrupted = await run('lost')
      expect(interrupted.result).toMatchObject({
        id: '@retained-instance',
        operation: 'retained-operation',
        access: { status: 'pending' },
      })
      expect(interrupted.stderr).toContain('Instance "demo" exists')
      expect(interrupted.stderr).toContain('same Admin target options')
      expect(await readFile(path, 'utf8')).toBe(original)
      const resumed = await run('complete')
      expect(resumed.result).toEqual({
        id: '@retained-instance',
        operation: 'retained-operation',
        access: { status: 'completed', user: 'reserved-owner' },
        selectionError: false,
      })
      const selected = JSON.parse(await readFile(path, 'utf8'))
      expect(selected.active).toBe('demo')
      expect(selected.instances.demo.url).toBe('https://new.example/api')
      expect(selected.instances.demo.organizationId).toBe('org_child')
    },
  )
})
