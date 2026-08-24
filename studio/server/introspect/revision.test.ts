import { describe, expect, test } from 'bun:test'

import { admittedBundleRevisionFromSdk } from './revision'

const REVISION = `sha256:${'a'.repeat(64)}` as const

describe('installed Bundle revision', () => {
  test('uses bundle admission before asking the installed schema owner for its revision', () => {
    const calls: string[] = []
    const root = { format: 'astrale.dsl', version: 'v1', origin: 'notes.example.dev' }
    const input = { wire: true }
    const sdk = {
      bundle: {
        accept(value: unknown) {
          calls.push('bundle.accept')
          expect(value).toBe(input)
          return { root, closure: [] }
        },
      },
      schema: {
        revision(value: unknown) {
          calls.push('schema.revision')
          expect(value).toBe(root)
          return REVISION
        },
      },
    }

    expect(admittedBundleRevisionFromSdk(sdk, input)).toBe(REVISION)
    expect(calls).toEqual(['bundle.accept', 'schema.revision'])
  })

  test('fails closed when bundle admission or the returned revision is invalid', () => {
    expect(
      admittedBundleRevisionFromSdk(
        { bundle: { accept: () => ({ root: {} }) }, schema: { revision: () => 'sha-short' } },
        {},
      ),
    ).toBeNull()
    expect(
      admittedBundleRevisionFromSdk(
        {
          bundle: {
            accept: () => {
              throw new Error('invalid bundle')
            },
          },
          schema: { revision: () => REVISION },
        },
        {},
      ),
    ).toBeNull()
  })
})
