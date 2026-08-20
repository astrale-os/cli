import { ResponseError, TransportError } from '@astrale-os/kernel-client'
import { describe, expect, test } from 'bun:test'

import { formatKernelError, functionInputIssues, schemaUpgradeHint } from '../errors'

const CONFLICT = 4001
const VALIDATION = 1003

describe('formatKernelError', () => {
  /** @evidence TEST-CLI-CONNECTION-MAPS-TYPED-TRANSPORT */
  test('maps typed discovery transport evidence without inspecting its cause message', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    const error = new TransportError('Publication discovery request failed.', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      phase: 'connect',
      delivery: 'unknown',
    }) as TransportError & { url?: string }
    error.url = 'https://localhost:8443/kernel/host'
    try {
      await formatKernelError(error, true)
    } finally {
      process.stderr.write = original
    }

    expect(JSON.parse(writes[0]!)).toMatchObject({
      error: 'CONNECTION_ERROR',
      message: 'Publication discovery request failed.',
      url: 'https://localhost:8443/kernel/host',
      phase: 'connect',
      delivery: 'unknown',
    })
    expect(writes[0]).not.toContain('ECONNREFUSED')
  })

  test('retains operation recovery only for outcome-unknown transport failure', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await formatKernelError(
        new TransportError('Request timed out.', {
          cause: new Error('timeout'),
          phase: 'timeout',
          delivery: 'unknown',
        }),
        true,
        undefined,
        false,
        {
          recovery: {
            operation: '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
            retry:
              'astrale domain install https://crm.test --direct --operation 4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
          },
        },
      )
    } finally {
      process.stderr.write = original
    }

    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]!)).toMatchObject({
      error: 'TIMEOUT',
      phase: 'timeout',
      delivery: 'unknown',
      operation: '4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
      retry:
        'astrale domain install https://crm.test --direct --operation 4a4c9a18-50f6-4d84-a7b7-2d83e3e45dc8',
    })
  })

  /** @evidence TEST-CLI-CONNECTION-PRESERVES-PUBLIC-SEMANTIC-REASON */
  test('preserves a Kernel-admitted semantic reason in machine output', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await formatKernelError(
        new ResponseError(CONFLICT, 'Schema change requires migration.', {
          code: 'DATA_MIGRATION_REQUIRED',
          details: {
            requirements: [
              {
                operation: 'validate-existing',
                reason: 'invalid-existing',
                subject: {
                  kind: 'definition',
                  ref: { origin: 'x.test', kind: 'class', name: 'X' },
                },
                work: { observedFacts: 1 },
              },
            ],
          },
        }),
        true,
      )
    } finally {
      process.stderr.write = original
    }
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]!)).toEqual({
      error: 'RESPONSE_ERROR',
      code: CONFLICT,
      message: 'Schema change requires migration.',
      reason: {
        code: 'DATA_MIGRATION_REQUIRED',
        details: {
          requirements: [
            {
              operation: 'validate-existing',
              reason: 'invalid-existing',
              subject: { kind: 'definition', ref: { origin: 'x.test', kind: 'class', name: 'X' } },
              work: { observedFacts: 1 },
            },
          ],
        },
      },
    })
  })

  test('explains deletion-only schema work without changing the Kernel reason', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await formatKernelError(
        new ResponseError(CONFLICT, 'Schema change requires migration.', {
          code: 'DATA_MIGRATION_REQUIRED',
          details: {
            requirements: [
              {
                operation: 'remove-facts',
                reason: 'destructive-change',
                subject: {
                  kind: 'definition',
                  ref: { origin: 'x.test', kind: 'class', name: 'X' },
                },
                work: { observedFacts: 1 },
              },
            ],
          },
        }),
        true,
      )
    } finally {
      process.stderr.write = original
    }

    expect(JSON.parse(writes[0]!)).toEqual({
      error: 'RESPONSE_ERROR',
      code: CONFLICT,
      message: 'Schema change requires migration.',
      reason: {
        code: 'DATA_MIGRATION_REQUIRED',
        details: {
          requirements: [
            {
              operation: 'remove-facts',
              reason: 'destructive-change',
              subject: {
                kind: 'definition',
                ref: { origin: 'x.test', kind: 'class', name: 'X' },
              },
              work: { observedFacts: 1 },
            },
          ],
        },
      },
      hint: 'Delete this data explicitly, then retry. No data was deleted.',
    })
  })

  test('prints an actionable message for deletion-only schema work', async () => {
    const errors: string[] = []
    const hints: string[] = []
    const originalError = console.error
    const originalLog = console.log
    console.error = (...values: unknown[]) => errors.push(values.map(String).join(' '))
    console.log = (...values: unknown[]) => hints.push(values.map(String).join(' '))
    try {
      await formatKernelError(
        new ResponseError(CONFLICT, 'Schema change requires migration.', {
          code: 'DATA_MIGRATION_REQUIRED',
          details: {
            requirements: [
              {
                operation: 'remove-facts',
                reason: 'destructive-change',
                subject: {
                  kind: 'definition',
                  ref: { origin: 'x.test', kind: 'class', name: 'X' },
                },
                work: { observedFacts: 1 },
              },
            ],
          },
        }),
        false,
      )
    } finally {
      console.error = originalError
      console.log = originalLog
    }

    expect(errors.join('\n')).toContain('DATA_MIGRATION_REQUIRED')
    expect(errors.join('\n')).toContain(
      'Existing business data still uses schema definitions being removed.',
    )
    expect(hints.join('\n')).toContain(
      'Delete this data explicitly, then retry. No data was deleted.',
    )
  })

  test('maps SDK class names to stable CLI error codes', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      const pathError = new Error('Path must have an Id or Domain anchor.')
      pathError.name = 'PathError'
      await formatKernelError(pathError, true)
    } finally {
      process.stderr.write = original
    }
    expect(JSON.parse(writes[0]!)).toEqual({
      error: 'PATH_INVALID',
      message: 'Path must have an Id or Domain anchor.',
    })
  })

  /** @evidence TEST-CLI-CONNECTION-PRESENTS-BOUNDED-REPAIRS */
  test('renders callable and Query repair coordinates for humans', async () => {
    const lines: string[] = []
    const originalError = console.error
    const originalLog = console.log
    console.error = (...values: unknown[]) => lines.push(values.join(' '))
    console.log = (...values: unknown[]) => lines.push(values.join(' '))
    try {
      await formatKernelError(
        new ResponseError(VALIDATION, 'Function input is invalid.', {
          code: 'FUNCTION_INPUT_INVALID',
          details: {
            issues: [
              {
                code: 'VALUE_SCHEMA_INSTANCE_INVALID',
                path: '/issuer',
                message: 'Object is missing required property issuer.',
              },
              {
                code: 'VALUE_SCHEMA_INSTANCE_INVALID',
                path: '/operationId',
                message: 'Object is missing required property operationId.',
              },
              {
                code: 'VALUE_SCHEMA_INSTANCE_INVALID',
                path: '/slug',
                message: 'Object is missing required property slug.',
              },
            ],
          },
        }),
        false,
      )
      await formatKernelError(
        new ResponseError(VALIDATION, 'Query input is invalid.', {
          code: 'QUERY_INPUT_INVALID',
          details: {
            phase: 'plan',
            issue: 'QUERY_DEFINITION_NOT_EDGE',
            path: '/steps/0/via/0',
          },
        }),
        false,
      )
    } finally {
      console.error = originalError
      console.log = originalLog
    }

    const rendered = lines.join('\n')
    expect(rendered).toContain('/issuer: Object is missing required property issuer.')
    expect(rendered).toContain('/operationId: Object is missing required property operationId.')
    expect(rendered).toContain('/slug: Object is missing required property slug.')
    expect(rendered).toContain('/steps/0/via/0  QUERY_DEFINITION_NOT_EDGE')
  })

  test('explains immutable issuer replacements and preserves the Kernel reason', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await formatKernelError(
        new ResponseError(5001, 'Schema operation is not supported.', {
          code: 'SCHEMA_UPGRADE_INCOMPATIBLE',
          details: {
            phase: 'upgrade',
            origin: 'grc.example',
            expected: 'https://old.example',
            actual: 'https://new.example',
          },
        }),
        true,
      )
    } finally {
      process.stderr.write = original
    }

    expect(JSON.parse(writes[0]!)).toEqual({
      error: 'RESPONSE_ERROR',
      code: 5001,
      message: 'Schema operation is not supported.',
      reason: {
        code: 'SCHEMA_UPGRADE_INCOMPATIBLE',
        details: {
          phase: 'upgrade',
          origin: 'grc.example',
          expected: 'https://old.example',
          actual: 'https://new.example',
        },
      },
      hint: schemaUpgradeHint({
        origin: 'grc.example',
        expected: 'https://old.example',
        actual: 'https://new.example',
      }),
    })
  })

  test('explains a private Domain source without exposing transport diagnostics', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await formatKernelError(
        new ResponseError(1003, 'Function input is invalid.', {
          code: 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC',
          details: { phase: 'publication', requiredScope: 'public' },
        }),
        true,
      )
    } finally {
      process.stderr.write = original
    }

    expect(JSON.parse(writes[0]!)).toEqual({
      error: 'RESPONSE_ERROR',
      code: 1003,
      message: 'Expose the Domain through a public HTTPS URL or public tunnel, then retry.',
      reason: {
        code: 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC',
        details: { phase: 'publication', requiredScope: 'public' },
      },
    })
  })

  test('prints the actionable private-source message in interactive output', async () => {
    const errors: string[] = []
    const hints: string[] = []
    const originalError = console.error
    const originalLog = console.log
    console.error = (...values: unknown[]) => errors.push(values.map(String).join(' '))
    console.log = (...values: unknown[]) => hints.push(values.map(String).join(' '))
    try {
      await formatKernelError(
        new ResponseError(1003, 'Function input is invalid.', {
          code: 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC',
          details: { phase: 'publication', requiredScope: 'public' },
        }),
        false,
      )
    } finally {
      console.error = originalError
      console.log = originalLog
    }

    expect(errors.join('\n')).toContain('SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC')
    expect(errors.join('\n')).toContain(
      'Expose the Domain through a public HTTPS URL or public tunnel, then retry.',
    )
    expect(hints).toEqual([])
  })

  test('preserves structured Function input issues in machine output', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await formatKernelError(
        new ResponseError(1003, 'Function input is invalid.', {
          code: 'FUNCTION_INPUT_INVALID',
          details: {
            issues: [
              {
                code: 'INVALID_FORMAT',
                path: '/customer/email',
                message: 'Must be a valid email address.',
              },
            ],
          },
        }),
        true,
      )
    } finally {
      process.stderr.write = original
    }

    expect(JSON.parse(writes[0]!)).toEqual({
      error: 'RESPONSE_ERROR',
      code: 1003,
      message: 'Function input is invalid.',
      reason: {
        code: 'FUNCTION_INPUT_INVALID',
        details: {
          issues: [
            {
              code: 'INVALID_FORMAT',
              path: '/customer/email',
              message: 'Must be a valid email address.',
            },
          ],
        },
      },
      hint: 'Use `astrale introspect <path>` to see the callable input.',
    })
  })

  test('prints Kernel-provided Function input messages in interactive output', async () => {
    const errors: string[] = []
    const details: string[] = []
    const originalError = console.error
    const originalLog = console.log
    console.error = (...values: unknown[]) => errors.push(values.map(String).join(' '))
    console.log = (...values: unknown[]) => details.push(values.map(String).join(' '))
    try {
      await formatKernelError(
        new ResponseError(1003, 'Function input is invalid.', {
          code: 'FUNCTION_INPUT_INVALID',
          details: {
            issues: [
              {
                code: 'INVALID_FORMAT',
                path: '/customer/email',
                message: 'Must be a valid email address.',
              },
            ],
          },
        }),
        false,
      )
    } finally {
      console.error = originalError
      console.log = originalLog
    }

    expect(errors.join('\n')).toContain('Function input is invalid.')
    expect(details.join('\n')).toContain(
      '/customer/email: Must be a valid email address. (INVALID_FORMAT)',
    )
    expect(details.join('\n')).not.toContain('astrale introspect')
  })

  test('keeps the introspection fallback for legacy Function input issues', async () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await formatKernelError(
        new ResponseError(1003, 'Function input is invalid.', {
          code: 'FUNCTION_INPUT_INVALID',
          details: { issues: [{ code: 'INVALID_FORMAT', path: '/customer/email' }] },
        }),
        true,
      )
    } finally {
      process.stderr.write = original
    }

    expect(JSON.parse(writes[0]!)).toMatchObject({
      reason: {
        code: 'FUNCTION_INPUT_INVALID',
        details: { issues: [{ code: 'INVALID_FORMAT', path: '/customer/email' }] },
      },
      hint: 'Use `astrale introspect <path>` to see the callable input.',
    })
  })

  test('rejects malformed public Function issue messages', () => {
    expect(
      functionInputIssues({
        code: 'FUNCTION_INPUT_INVALID',
        details: {
          issues: [
            { code: 'INVALID_FORMAT', path: '/safe', message: 'Safe message.' },
            { code: 'INVALID_FORMAT', path: 'not-a-pointer', message: 'Unsafe path.' },
            { code: 'INVALID_FORMAT', path: '/unsafe', message: 'Unsafe\nmessage.' },
          ],
        },
      }),
    ).toEqual([{ code: 'INVALID_FORMAT', path: '/safe', message: 'Safe message.' }])
  })
})
