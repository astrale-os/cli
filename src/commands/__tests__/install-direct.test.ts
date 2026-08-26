import type { InstallResult } from '@astrale-os/sdk/client/schema'

import { defineSchema, schema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import { directInstallCallInput, directInstallPresentation } from '../domain/install'

const currentRevision = schema.revision(defineSchema('tasks.astrale.ai', {}))

describe('directInstallCallInput', () => {
  test('sends the current remote install syscall, not a legacy url list', () => {
    const operation = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
    const input = directInstallCallInput('https://tasks.example.test', operation, 'secret')

    expect(String(input.operation)).toBe(operation)
    expect(input.domains).toEqual([
      {
        publication: {
          url: 'https://tasks.example.test',
          token: 'secret',
        },
      },
    ])
  })

  test('presents a committed install from its receipt', () => {
    const operation = directInstallCallInput(
      'https://tasks.example.test',
      '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
    ).operation
    const result = {
      changed: true,
      receipt: {
        operation,
        transitions: [
          {
            intent: {
              transition: 'transition-1',
              operation,
              origin: 'tasks.astrale.ai',
              previous: null,
              generation: {
                origin: 'tasks.astrale.ai',
                revision: currentRevision,
                generation: 'sha256:generation',
              },
            },
            phase: 'cutover',
            state: 'committed',
          },
        ],
      },
    } satisfies InstallResult

    expect(directInstallPresentation(result, 'ignored')).toEqual({
      operation: '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
      origin: 'tasks.astrale.ai',
      revision: currentRevision,
      status: 'installed',
    })
  })

  test('presents an idempotent install from the current Domain observation', () => {
    const operation = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
    const result = {
      changed: false,
      domains: [
        {
          origin: 'tasks.astrale.ai',
          revision: currentRevision,
          generation: 'sha256:generation',
          publication: null,
          readiness: 'sha256:readiness',
          capabilities: { requested: {}, materialized: {} },
          bindings: { callables: [], views: [] },
        },
      ],
    } satisfies InstallResult

    expect(directInstallPresentation(result, operation)).toEqual({
      operation,
      origin: 'tasks.astrale.ai',
      revision: currentRevision,
      status: 'already current',
    })
  })

  test('rejects a changed result without a committed transition', () => {
    const result = {
      changed: true,
      receipt: { operation: '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8', transitions: [] },
    } as unknown as InstallResult

    expect(() => directInstallPresentation(result, 'ignored')).toThrow(
      'Kernel install returned no committed Domain transition.',
    )
  })

  test('rejects a committed transition without an installed generation', () => {
    const operation = directInstallCallInput(
      'https://tasks.example.test',
      '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
    ).operation
    const result = {
      changed: true,
      receipt: {
        operation,
        transitions: [
          {
            intent: {
              transition: 'transition-1',
              operation,
              origin: 'tasks.astrale.ai',
              previous: null,
              generation: null,
            },
            phase: 'cutover',
            state: 'committed',
          },
        ],
      },
    } satisfies InstallResult

    expect(() => directInstallPresentation(result, 'ignored')).toThrow(
      'Kernel install returned a committed transition without a Domain generation.',
    )
  })
})
