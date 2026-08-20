import { ResponseError } from '@astrale-os/kernel-client'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { OwnedInstanceInfo } from '../../lib/admin-instance'

class ExitError extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

const calls: Array<{ path: string; params: unknown }> = []
let inventory: OwnedInstanceInfo[] = []

const hostCall = mock(async (call: { target: string; input: unknown }): Promise<unknown> => {
  const path = call.target
  const params = call.input
  calls.push({ path, params })
  throw new Error(`Unexpected admin call: ${path}`)
})

mock.module('../../connection', () => ({
  createPathCall: (path: string, input: unknown) => ({
    target: path,
    input,
  }),
  runKernelCommand: mock(),
  withAdminClientSession: async (
    _opts: unknown,
    run: (ctx: { session: { call: typeof hostCall } }) => Promise<unknown>,
  ) => run({ session: { call: hostCall } }),
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

  test('preserves an incompatible issuer reason returned through Admin', async () => {
    inventory = [
      {
        id: 'owned-id',
        slug: 'owned',
        url: 'https://owned.eu.astrale.ai',
        state: 'ready',
      },
    ]
    const domain = {
      id: 'crm-id',
      origin: 'crm.acme.dev',
      name: 'CRM',
      url: 'https://crm.acme.dev',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    }
    const failure = new ResponseError(5001, 'Schema operation is not supported.', {
      code: 'SCHEMA_UPGRADE_INCOMPATIBLE',
      details: {
        phase: 'upgrade',
        origin: domain.origin,
        issue: 'issuer-changed',
        installedIssuer: 'https://old.example',
        replacementIssuer: 'https://new.example',
      },
    })
    const { installViaAdmin } = await import('../domain/install')

    await expect(
      installViaAdmin(
        domain.origin,
        {
          instance: 'owned',
          json: true,
          noPrompt: true,
        },
        {
          listInstances: async () => inventory,
          listDomains: async () => [domain],
          install: async () => {
            throw failure
          },
        },
      ),
    ).rejects.toEqual(new ExitError(1))

    expect(JSON.parse(stderr)).toEqual({
      error: 'RESPONSE_ERROR',
      code: 5001,
      message: 'Schema operation is not supported.',
      reason: {
        code: 'SCHEMA_UPGRADE_INCOMPATIBLE',
        details: {
          phase: 'upgrade',
          origin: 'crm.acme.dev',
          issue: 'issuer-changed',
          installedIssuer: 'https://old.example',
          replacementIssuer: 'https://new.example',
        },
      },
      hint: expect.stringContaining('astrale domain uninstall crm.acme.dev'),
    })
  })
})
