import { describe, expect, test } from 'bun:test'

import { functionInputIssues, queryInputRepair } from '../reasons'

describe('public reason presentation admission', () => {
  /** @evidence TEST-CLI-CONNECTION-ADMITS-BOUNDED-REASONS */
  test('admits bounded public callable issues and filters unsafe additions', () => {
    expect(
      functionInputIssues({
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
              path: '/slug',
              message: 'Object is missing required property slug.',
            },
            {
              code: 'VALUE_SCHEMA_INSTANCE_INVALID',
              path: '/unsafe',
              message: 'private\ndiagnostic',
            },
          ],
        },
      }),
    ).toEqual([
      {
        code: 'VALUE_SCHEMA_INSTANCE_INVALID',
        path: '/issuer',
        message: 'Object is missing required property issuer.',
      },
      {
        code: 'VALUE_SCHEMA_INSTANCE_INVALID',
        path: '/slug',
        message: 'Object is missing required property slug.',
      },
    ])
  })

  test('admits exact Query repair variants and rejects unbounded additions', () => {
    expect(
      queryInputRepair({
        code: 'QUERY_INPUT_INVALID',
        details: {
          phase: 'plan',
          issue: 'QUERY_DEFINITION_NOT_EDGE',
          path: '/steps/0/via/0',
        },
      }),
    ).toEqual({
      phase: 'plan',
      issue: 'QUERY_DEFINITION_NOT_EDGE',
      path: '/steps/0/via/0',
    })
    expect(
      queryInputRepair({
        code: 'QUERY_INPUT_INVALID',
        details: { phase: 'limit', limit: 'steps', maximum: 4, actual: 5 },
      }),
    ).toEqual({ phase: 'limit', limit: 'steps', maximum: 4, actual: 5 })
    expect(
      queryInputRepair({
        code: 'QUERY_INPUT_INVALID',
        details: {
          phase: 'plan',
          issue: 'QUERY_DEFINITION_NOT_EDGE',
          path: '/steps/0/via/0',
          provider: 'private',
        },
      }),
    ).toBeUndefined()
  })
})
