import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { OwnedInstanceInfo } from '../../lib/admin-instance'

import { adminDomainMethod } from '../../lib/admin-domain'
import { adminInstanceMethod } from '../../lib/admin-instance'

class ExitError extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

const calls: Array<{ path: string; params: unknown }> = []
let inventory: OwnedInstanceInfo[] = []

const clientCall = mock(async (path: string, params: unknown): Promise<unknown> => {
  calls.push({ path, params })
  if (path === adminInstanceMethod('listMine')) return inventory
  throw new Error(`Unexpected admin call: ${path}`)
})

mock.module('../../kernel', () => ({
  runKernelCommand: mock(),
}))

mock.module('../../kernel/client', () => ({
  withAdminKernelClient: async (
    _opts: unknown,
    run: (ctx: { client: { call: typeof clientCall } }) => Promise<unknown>,
  ) => run({ client: { call: clientCall } }),
}))

let stderr = ''
let originalExit: typeof process.exit
let originalStderrWrite: typeof process.stderr.write

beforeEach(() => {
  calls.length = 0
  inventory = []
  stderr = ''
  clientCall.mockClear()
  originalExit = process.exit
  originalStderrWrite = process.stderr.write.bind(process.stderr)
  process.exit = ((code?: string | number | null) => {
    throw new ExitError(code)
  }) as typeof process.exit
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.exit = originalExit
  process.stderr.write = originalStderrWrite
})

async function runInstall(instance: string): Promise<void> {
  const command = (await import('../domain/install')).default
  const action = command.action as (
    target: string | undefined,
    opts: Record<string, unknown>,
  ) => Promise<void>
  await action('crm.acme.dev', {
    instance,
    json: true,
    noPrompt: true,
  })
}

describe('admin domain install owner boundary', () => {
  test('rejects a foreign target after listMine without attempting an install', async () => {
    inventory = [
      {
        id: 'owned-id',
        slug: 'owned',
        url: 'https://owned.eu.astrale.ai',
        state: 'ready',
      },
    ]

    await expect(runInstall('foreign')).rejects.toEqual(new ExitError(1))

    expect(JSON.parse(stderr)).toMatchObject({
      error: 'INSTANCE_NOT_MANAGED',
      message: 'Instance "foreign" is not admin-managed (managed: owned).',
    })
    expect(calls).toEqual([{ path: adminInstanceMethod('listMine'), params: {} }])
  })

  test.each([
    {
      state: 'provisioning' as const,
      phase: 'installing:default-domains',
      error: undefined,
    },
    {
      state: 'failed' as const,
      phase: undefined,
      error: 'postInstall failed',
    },
  ])('rejects an owned $state target before the install RPC', async (status) => {
    inventory = [
      {
        id: `${status.state}-id`,
        slug: 'owned',
        url: 'https://owned.eu.astrale.ai',
        ...status,
      },
    ]

    await expect(runInstall('owned')).rejects.toEqual(new ExitError(1))

    const payload = JSON.parse(stderr) as { error: string; message: string; hint?: string }
    expect(payload.error).toBe('INSTANCE_NOT_READY')
    expect(payload.message).toContain(`Instance "owned" is ${status.state}`)
    expect(payload.hint).toBe(status.error ?? 'Run: astrale instance status owned')
    expect(calls).toEqual([{ path: adminInstanceMethod('listMine'), params: {} }])
    expect(calls.some((call) => call.path === adminDomainMethod('install'))).toBe(false)
  })
})
