import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../errors'
import { parseTtl } from '../token'

describe('parseTtl', () => {
  test('defaults to 3600 seconds', () => {
    expect(parseTtl(undefined)).toBe(3600)
  })

  test('rejects non-positive and non-integer values', () => {
    expect(() => parseTtl('abc')).toThrow(AstraleError)
    expect(() => parseTtl('0')).toThrow(AstraleError)
    expect(() => parseTtl('-5')).toThrow(AstraleError)
    expect(() => parseTtl('1.5')).toThrow(AstraleError)
  })

  test('admits a positive integer', () => {
    expect(parseTtl('90')).toBe(90)
  })
})
