import * as sdk from '@astrale-os/sdk/schema'
import { defineSchema } from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import { admittedBundleRevisionFromSdk } from './revision'

const schema = defineSchema('notes.example.dev', {})
const wire = JSON.parse(JSON.stringify(sdk.bundle.create(schema)))

describe('installed Bundle revision', () => {
  test('uses Bundle admission and the resolved Domain identity', () => {
    const calls: string[] = []
    const wrapped = {
      ...sdk,
      bundle: {
        ...sdk.bundle,
        accept(value: unknown) {
          calls.push('bundle.accept')
          return sdk.bundle.accept(value)
        },
      },
      schema: {
        ...sdk.schema,
        resolve(value: typeof schema) {
          calls.push('schema.resolve')
          return sdk.schema.resolve(value)
        },
      },
    } as unknown as typeof sdk

    expect(admittedBundleRevisionFromSdk(wrapped, wire)).toBe(sdk.schema.revision(schema))
    expect(calls).toEqual(['bundle.accept', 'schema.resolve'])
  })

  test('fails closed when Bundle admission or the resolved identity is invalid', () => {
    expect(admittedBundleRevisionFromSdk({} as typeof sdk, {})).toBeNull()
    expect(
      admittedBundleRevisionFromSdk(
        {
          ...sdk,
          schema: {
            ...sdk.schema,
            resolve: () => ({ source: schema, revision: 'sha-short' }),
          },
        } as unknown as typeof sdk,
        wire,
      ),
    ).toBeNull()
  })
})
