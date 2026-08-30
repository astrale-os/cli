import type { UnresolvedIdentityExpr } from '@astrale-os/sdk/auth'

import { describe, expect, test } from 'bun:test'

import { exchangeCallerProof } from '../exchange-grant'

const caller = (credential = 'caller-proof'): UnresolvedIdentityExpr => ({
  kind: 'identity',
  credential,
})
const self = (): UnresolvedIdentityExpr => ({ kind: 'identity', self: true })

describe('exchange caller proof', () => {
  test('accepts caller-only and exact trusted unions in either order', () => {
    expect(exchangeCallerProof(caller())).toBe('caller-proof')
    expect(exchangeCallerProof({ kind: 'union', operands: [self(), caller('forward')] })).toBe(
      'forward',
    )
    expect(exchangeCallerProof({ kind: 'union', operands: [caller('reverse'), self()] })).toBe(
      'reverse',
    )
  })

  test.each([
    ['bare self', self()],
    ['duplicate self', { kind: 'union', operands: [self(), self()] }],
    ['duplicate caller', { kind: 'union', operands: [caller(), caller('other')] }],
    ['extra operand', { kind: 'union', operands: [self(), caller(), caller('extra')] }],
    [
      'nested union',
      { kind: 'union', operands: [self(), { kind: 'union', operands: [self(), caller()] }] },
    ],
    ['intersection', { kind: 'intersect', operands: [self(), caller()] }],
    ['exclusion', { kind: 'exclude', base: caller(), excluded: [self()] }],
  ] satisfies ReadonlyArray<readonly [string, UnresolvedIdentityExpr]>)(
    'rejects %s',
    (_, value) => {
      expect(exchangeCallerProof(value)).toBeUndefined()
    },
  )
})
