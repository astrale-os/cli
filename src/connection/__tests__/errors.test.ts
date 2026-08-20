import { ResponseError } from '@astrale-os/kernel-client'
import { describe, expect, test } from 'bun:test'

import { formatKernelError, schemaUpgradeHint, stripMethodSuffix } from '../errors'

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
})
