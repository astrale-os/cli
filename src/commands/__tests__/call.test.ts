import { describe, expect, test } from 'bun:test'

import { parseKeyValue, coerceValue } from '../call'

describe('coerceValue', () => {
  test('parses JSON objects', () => {
    expect(coerceValue('{"a":1}')).toEqual({ a: 1 })
  })

  test('parses JSON arrays', () => {
    expect(coerceValue('[1,2,3]')).toEqual([1, 2, 3])
  })

  test('falls through on invalid JSON object', () => {
    expect(coerceValue('{not-json}')).toBe('{not-json}')
  })

  test('parses booleans', () => {
    expect(coerceValue('true')).toBe(true)
    expect(coerceValue('false')).toBe(false)
  })

  test('parses null', () => {
    expect(coerceValue('null')).toBe(null)
  })

  test('parses numbers', () => {
    expect(coerceValue('42')).toBe(42)
    expect(coerceValue('3.14')).toBe(3.14)
    expect(coerceValue('-1')).toBe(-1)
    expect(coerceValue('0')).toBe(0)
  })

  test('returns strings for non-special values', () => {
    expect(coerceValue('hello')).toBe('hello')
    expect(coerceValue('')).toBe('')
    expect(coerceValue('some text')).toBe('some text')
  })

  test('preserves hex, octal, and exotic numeric strings as strings', () => {
    expect(coerceValue('0x1f')).toBe('0x1f')
    expect(coerceValue('0o77')).toBe('0o77')
    expect(coerceValue('0b101')).toBe('0b101')
    expect(coerceValue('1e308')).toBe('1e308')
    expect(coerceValue('Infinity')).toBe('Infinity')
  })
})

describe('parseKeyValue', () => {
  test('parses simple key=value pairs', () => {
    expect(parseKeyValue(['name=test', 'count=5'])).toEqual({
      name: 'test',
      count: 5,
    })
  })

  test('handles values with = in them', () => {
    expect(parseKeyValue(['query=a=b'])).toEqual({ query: 'a=b' })
  })

  test('throws on missing =', () => {
    expect(() => parseKeyValue(['noequals'])).toThrow('expected key=value')
  })

  test('parses JSON values', () => {
    expect(parseKeyValue(['data={"x":1}'])).toEqual({ data: { x: 1 } })
  })

  test('handles empty value', () => {
    expect(parseKeyValue(['key='])).toEqual({ key: '' })
  })
})
