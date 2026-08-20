import type { OperationId } from '@astrale-os/kernel-client/schema'

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { installDirect } from '../domain/install'

const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8' as OperationId
const RETRY = '139137b5-af47-47ce-92b2-b64a2b0c63d7' as OperationId

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('direct domain install operation identity', () => {
  test('generates one operation before transport and exposes it for recovery', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ domainName: 'crm.test' }),
    ) as unknown as typeof fetch
    const create = mock(() => GENERATED)
    const requests: unknown[] = []
    let recovery: unknown

    await installDirect(
      'https://crm.test',
      { direct: true, json: true },
      {
        createOperationId: create,
        runKernelCommand: async (input) => {
          recovery = input.recovery
          requests.push(
            await input.fn({
              session: {
                schema: { install: async (request: unknown) => request },
              },
            } as never),
          )
        },
      },
    )

    expect(create).toHaveBeenCalledTimes(1)
    expect(requests).toEqual([
      {
        operation: GENERATED,
        domains: [{ source: { kind: 'remote', url: 'https://crm.test' } }],
      },
    ])
    expect(recovery).toEqual({
      operation: GENERATED,
      retry: `astrale domain install https://crm.test --direct --operation ${GENERATED}`,
    })
  })

  test('accepts an explicit operation only as the exact retry identity', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ domainName: 'crm.test' }),
    ) as unknown as typeof fetch
    const create = mock(() => GENERATED)
    const accepted: string[] = []
    const requests: unknown[] = []

    await installDirect(
      'https://crm.test',
      { direct: true, operation: RETRY, json: true },
      {
        createOperationId: create,
        acceptOperationId: (input) => {
          accepted.push(String(input))
          return RETRY
        },
        runKernelCommand: async (input) => {
          requests.push(
            await input.fn({
              session: {
                schema: { install: async (request: unknown) => request },
              },
            } as never),
          )
        },
      },
    )

    expect(create).not.toHaveBeenCalled()
    expect(accepted).toEqual([RETRY])
    expect(requests).toEqual([
      {
        operation: RETRY,
        domains: [{ source: { kind: 'remote', url: 'https://crm.test' } }],
      },
    ])
  })
})
