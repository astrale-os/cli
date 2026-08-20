import { ResponseError } from '@astrale-os/kernel-client'
import { describe, expect, test } from 'bun:test'

import {
  formatKernelError,
  functionInputIssues,
  schemaUpgradeHint,
  stripMethodSuffix,
} from '../errors'

const CONFLICT = 4001

describe('stripMethodSuffix', () => {
  test('strips ::listChildren from path', () => {
    expect(stripMethodSuffix('Path not found: "/nonexistent::listChildren"')).toBe(
      'Path not found: "/nonexistent"',
    )
  })

  test('strips ::get from path', () => {
    expect(stripMethodSuffix('Path not found: "/some/path::get"')).toBe(
      'Path not found: "/some/path"',
    )
  })

  test('strips any method name', () => {
    expect(stripMethodSuffix('"/kernel.astrale.ai/Root::describe"')).toBe(
      '"/kernel.astrale.ai/Root"',
    )
  })

  test('does not strip from non-path strings', () => {
    expect(stripMethodSuffix('regular::text')).toBe('regular::text')
  })

  test('handles multiple paths in one message', () => {
    expect(stripMethodSuffix('"/a/b::get" and "/c/d::list"')).toBe('"/a/b" and "/c/d"')
  })

  test('preserves messages without method suffixes', () => {
    expect(stripMethodSuffix('No path found')).toBe('No path found')
  })

  test('does not strip single colon (not a method dispatch)', () => {
    expect(stripMethodSuffix('"/a/b:notMethod"')).toBe('"/a/b:notMethod"')
  })
})

describe('formatKernelError', () => {
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
