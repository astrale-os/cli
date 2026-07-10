import { describe, expect, test } from 'bun:test'

import { redactArgv } from '../redact'

describe('redactArgv', () => {
  test('redacts the value following a secret flag', () => {
    expect(redactArgv(['--token', 'abc123', '--json'])).toEqual(['--token', '<redacted>', '--json'])
  })

  test('matches secret substrings in flag names, case-insensitively', () => {
    expect(redactArgv(['--api-Token', 's', '--Bearer', 'b', '--jwk', 'k'])).toEqual([
      '--api-Token',
      '<redacted>',
      '--Bearer',
      '<redacted>',
      '--jwk',
      '<redacted>',
    ])
  })

  test('redacts the value part of inline k=v secret args', () => {
    expect(redactArgv(['--secret=hunter2', 'password=p', '--verbose'])).toEqual([
      '--secret=<redacted>',
      'password=<redacted>',
      '--verbose',
    ])
  })

  test('leaves non-secret flags and their values intact', () => {
    expect(redactArgv(['get', '--depth', '3', '--format=json'])).toEqual([
      'get',
      '--depth',
      '3',
      '--format=json',
    ])
  })

  test('truncates any arg longer than 200 chars to 200 + ellipsis', () => {
    const long = 'x'.repeat(300)
    const [only] = redactArgv([long])
    expect(only).toBe('x'.repeat(200) + '…')
    expect([...only].length).toBe(201)
  })

  test('a secret value is redacted before length matters', () => {
    expect(redactArgv(['--password', 'y'.repeat(500)])).toEqual(['--password', '<redacted>'])
  })

  test('caps the array at 40 items with a …+N marker', () => {
    const args = Array.from({ length: 45 }, (_, i) => `a${i}`)
    const out = redactArgv(args)
    expect(out.length).toBe(41)
    expect(out.slice(0, 40)).toEqual(args.slice(0, 40))
    expect(out[40]).toBe('…+5')
  })

  test('does not cap at exactly 40 items', () => {
    const args = Array.from({ length: 40 }, (_, i) => `a${i}`)
    expect(redactArgv(args)).toEqual(args)
  })

  test('a trailing secret flag with no value does not throw', () => {
    expect(redactArgv(['call', '--token'])).toEqual(['call', '--token'])
  })
})
