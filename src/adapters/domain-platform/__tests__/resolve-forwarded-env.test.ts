import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { resolveForwardedEnv } from '../cloudflare-helpers'

/**
 * `resolveForwardedEnv` is the fix for the import-time footgun: it must
 * read `process.env` at call time (after the preUp hook), not freeze it
 * at module import. These tests pin that contract.
 */
describe('resolveForwardedEnv', () => {
  const TOUCHED = ['RFE_REQUIRED', 'RFE_OPTIONAL', 'RFE_LATE'] as const
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]))
    for (const k of TOUCHED) delete process.env[k]
  })
  afterEach(() => {
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  test('undefined config → empty object', () => {
    expect(resolveForwardedEnv(undefined)).toEqual({})
    expect(resolveForwardedEnv({})).toEqual({})
  })

  test('forwardEnv: unset name throws (fail loud, no silent empty write)', () => {
    expect(() => resolveForwardedEnv({ forwardEnv: ['RFE_REQUIRED'] })).toThrow(/RFE_REQUIRED/)
  })

  test('forwardEnv: set name forwards its value', () => {
    process.env.RFE_REQUIRED = 'vck_real'
    expect(resolveForwardedEnv({ forwardEnv: ['RFE_REQUIRED'] })).toEqual({
      RFE_REQUIRED: 'vck_real',
    })
  })

  test('forwardEnvOptional: unset name is omitted entirely (no "" entry)', () => {
    const out = resolveForwardedEnv({ forwardEnvOptional: ['RFE_OPTIONAL'] })
    expect('RFE_OPTIONAL' in out).toBe(false)
    expect(out).toEqual({})
  })

  test('forwardEnvOptional: set name is included', () => {
    process.env.RFE_OPTIONAL = 'sandbox/agent:dev'
    expect(resolveForwardedEnv({ forwardEnvOptional: ['RFE_OPTIONAL'] })).toEqual({
      RFE_OPTIONAL: 'sandbox/agent:dev',
    })
  })

  test('resolves at call time, not import time (simulates preUp populating env)', () => {
    const config = { forwardEnv: ['RFE_LATE'] }
    // First call mirrors "config read before preUp" — the var is unset, so a
    // required forward now fails loud rather than freezing an empty value.
    expect(() => resolveForwardedEnv(config)).toThrow(/RFE_LATE/)
    // preUp loads `.env` into process.env...
    process.env.RFE_LATE = 'loaded-by-preup'
    // ...and the post-preUp call sees it.
    expect(resolveForwardedEnv(config)).toEqual({ RFE_LATE: 'loaded-by-preup' })
  })
})
