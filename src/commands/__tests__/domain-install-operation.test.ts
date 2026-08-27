import { defineSchema } from '@astrale-os/sdk/schema'
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { releaseFor } from '../../__tests__/fixtures/publication'
import { installDirect } from '../domain/install'

const GENERATED = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
const RETRY = '139137b5-af47-47ce-92b2-b64a2b0c63d7'

const originalFetch = globalThis.fetch

const schema = defineSchema('crm.test', {})
const deployed = releaseFor(schema, 'https://crm.test').publication

function publicationResponse(): Response {
  return Response.json(deployed)
}

class ExitError extends Error {}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('direct domain install operation identity', () => {
  test('generates one operation before transport and exposes it for recovery', async () => {
    globalThis.fetch = mock(async () => publicationResponse()) as unknown as typeof fetch
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
              session: { schema: { install: async (input: unknown) => input } },
            } as never),
          )
        },
      },
    )

    expect(create).toHaveBeenCalledTimes(1)
    expect(requests).toEqual([
      {
        operation: GENERATED,
        domains: [{ publication: { url: 'https://crm.test' } }],
      },
    ])
    expect(recovery).toEqual({
      operation: GENERATED,
      retry: `astrale domain install https://crm.test --direct --operation ${GENERATED}`,
    })
  })

  test('accepts an explicit operation only as the exact retry identity', async () => {
    globalThis.fetch = mock(async () => publicationResponse()) as unknown as typeof fetch
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
              session: { schema: { install: async (input: unknown) => input } },
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
        domains: [{ publication: { url: 'https://crm.test' } }],
      },
    ])
  })

  test('retains an explicit absent-generation guard in the request and recovery command', async () => {
    globalThis.fetch = mock(async () => publicationResponse()) as unknown as typeof fetch
    const requests: unknown[] = []
    let recovery: unknown

    await installDirect(
      'https://crm.test',
      { direct: true, currentGeneration: 'absent', json: true },
      {
        createOperationId: () => GENERATED,
        runKernelCommand: async (input) => {
          recovery = input.recovery
          requests.push(
            await input.fn({
              session: { schema: { install: async (request: unknown) => request } },
            } as never),
          )
        },
      },
    )

    expect(requests).toEqual([
      {
        operation: GENERATED,
        domains: [
          {
            publication: { url: 'https://crm.test' },
            currentGeneration: null,
          },
        ],
      },
    ])
    expect(recovery).toEqual({
      operation: GENERATED,
      retry:
        `astrale domain install https://crm.test --direct --operation ${GENERATED}` +
        ' --current-generation absent',
    })
  })

  test('keeps identity-override consent warnings out of machine output', async () => {
    globalThis.fetch = mock(async () => publicationResponse()) as unknown as typeof fetch
    const originalError = console.error
    const warnings: unknown[][] = []
    console.error = (...args: unknown[]) => {
      warnings.push(args)
    }
    try {
      await installDirect(
        'https://alias.test',
        { direct: true, json: true, allowIdentityOverride: true },
        {
          createOperationId: () => GENERATED,
          runKernelCommand: async () => undefined,
        },
      )
    } finally {
      console.error = originalError
    }

    expect(warnings).toEqual([])
  })

  test('rejects a non-UUID operation before metadata or Kernel transport', async () => {
    const originalExit = process.exit
    const originalWrite = process.stderr.write
    const fetch = mock(async () => publicationResponse())
    const run = mock(async () => undefined)
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch
    process.exit = (() => {
      throw new ExitError('exit')
    }) as typeof process.exit
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      await expect(
        installDirect(
          'https://crm.test',
          { direct: true, operation: 'guessable-operation', json: true },
          { runKernelCommand: run },
        ),
      ).rejects.toBeInstanceOf(ExitError)
    } finally {
      process.exit = originalExit
      process.stderr.write = originalWrite
    }

    expect(fetch).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
