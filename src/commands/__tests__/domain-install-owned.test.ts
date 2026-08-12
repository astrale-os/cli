import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { OwnedInstanceInfo } from '../../lib/admin-instance'

class ExitError extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

const calls: Array<{ path: string; params: unknown }> = []
let inventory: OwnedInstanceInfo[] = []

const hostCall = mock(
  async (call: { target: { kind: string; path: unknown }; input: unknown }): Promise<unknown> => {
    const path = String(call.target.path)
    const params = call.input
    calls.push({ path, params })
    throw new Error(`Unexpected admin call: ${path}`)
  },
)

mock.module('../../connection', () => ({
  createPathCall: (path: string, input: unknown) => ({
    target: { kind: 'path', path },
    input,
  }),
  runKernelCommand: mock(),
  withAdminHostSession: async (
    _opts: unknown,
    run: (ctx: { host: { call: typeof hostCall } }) => Promise<unknown>,
  ) => run({ host: { call: hostCall } }),
}))

let stderr = ''
let originalExit: typeof process.exit
let originalStderrWrite: typeof process.stderr.write

beforeEach(() => {
  calls.length = 0
  inventory = []
  stderr = ''
  hostCall.mockClear()
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
  const { installViaAdmin } = await import('../domain/install')
  await installViaAdmin(
    'crm.acme.dev',
    {
      instance,
      json: true,
      noPrompt: true,
    },
    { listInstances: async () => inventory },
  )
}

describe('admin domain install owner boundary', () => {
  test('rejects a foreign target after the V2 graph inventory without attempting an install', async () => {
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
    expect(calls).toEqual([])
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
    expect(calls).toEqual([])
    expect(calls).toEqual([])
  })
})
