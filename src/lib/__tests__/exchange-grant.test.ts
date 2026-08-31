import type { UnresolvedIdentityExpr } from '@astrale-os/sdk/auth'

import { describe, expect, test } from 'bun:test'

import { exchangeCallerProof } from '../exchange-grant'

const caller = (credential = 'caller-proof'): UnresolvedIdentityExpr => ({
  kind: 'identity',
  credential,
})
const self = (): UnresolvedIdentityExpr => ({ kind: 'identity', self: true })

describe('exchange caller proof', () => {
  test('accepts only one caller credential', () => {
    expect(exchangeCallerProof(caller())).toBe('caller-proof')
  })

  test.each([
    ['bare self', self()],
    ['self and caller union', { kind: 'union', operands: [self(), caller()] }],
    ['caller and self union', { kind: 'union', operands: [caller(), self()] }],
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
