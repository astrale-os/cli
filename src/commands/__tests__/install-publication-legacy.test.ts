import type { InstallResult } from '@astrale-os/sdk/client/schema'

import { defineSchema, schema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import {
  publicationInstallInput,
  publicationInstallPresentation,
  publicationInstallRetry,
} from '../domain/legacy/publication-install'

const currentRevision = schema.revision(defineSchema('tasks.astrale.ai', {}))

describe('legacy publication install (Kernels without the installed listing)', () => {
  test('sends the pre-release publication request, byte for byte, for one URL', () => {
    const operation = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
    const input = publicationInstallInput(['https://tasks.example.test'], operation, 'secret')

    expect(String(input.operation)).toBe(operation)
    expect(input.domains).toEqual([
      {
        publication: {
          url: 'https://tasks.example.test',
          token: 'secret',
        },
      },
    ])
    expect(JSON.stringify(publicationInstallInput(['https://tasks.example.test'], operation))).toBe(
      `{"operation":"${operation}","domains":[{"publication":{"url":"https://tasks.example.test"}}]}`,
    )
  })

  test('groups several URLs in one request, in the order written', () => {
    const operation = '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8'
    expect(
      publicationInstallInput(['https://b.example.test', 'https://a.example.test'], operation)
        .domains,
    ).toEqual([
      { publication: { url: 'https://b.example.test' } },
      { publication: { url: 'https://a.example.test' } },
    ])
  })

  test('prints the pre-release retry command', () => {
    expect(
      publicationInstallRetry(['https://crm.test'], '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8', {
        instance: 'staging',
      }),
    ).toBe(
      'astrale domain install https://crm.test --direct --operation 4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8 -i staging',
    )
  })

  test('presents a committed install from its receipt', () => {
    const operation = publicationInstallInput(
      ['https://tasks.example.test'],
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

    expect(publicationInstallPresentation(result, 'ignored')).toEqual([
      {
        operation: '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
        origin: 'tasks.astrale.ai',
        revision: currentRevision,
        status: 'installed',
      },
    ])
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

    expect(publicationInstallPresentation(result, operation)).toEqual([
      {
        operation,
        origin: 'tasks.astrale.ai',
        revision: currentRevision,
        status: 'already current',
      },
    ])
  })

  test('rejects a changed result without a committed transition', () => {
    const result = {
      changed: true,
      receipt: { operation: '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8', transitions: [] },
    } as unknown as InstallResult

    expect(() => publicationInstallPresentation(result, 'ignored')).toThrow(
      'Kernel install returned no committed Domain transition.',
    )
  })

  test('rejects a committed transition without an installed generation', () => {
    const operation = publicationInstallInput(
      ['https://tasks.example.test'],
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

    expect(() => publicationInstallPresentation(result, 'ignored')).toThrow(
      'Kernel install returned a committed transition without a Domain generation.',
    )
  })
})
