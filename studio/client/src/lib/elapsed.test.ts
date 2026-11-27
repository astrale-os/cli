import { REGISTRY_READ_LIMIT_MS } from '@shared/contracts/versions'
import { expect, test } from 'bun:test'

import { durationWords, readingClock } from './elapsed'

test('a duration reads in seconds, then minutes and seconds', () => {
  expect(durationWords(0)).toBe('0 s')
  expect(durationWords(42_900)).toBe('42 s')
  expect(durationWords(65_000)).toBe('1 min 05 s')
  expect(durationWords(360_000)).toBe('6 min')
  expect(durationWords(-5)).toBe('0 s')
})

test('a read says how long it has run once it is not quick, and its limit once past it', () => {
  expect(readingClock(400, 10_000)).toEqual({ elapsed: undefined, overdue: false, limit: '10 s' })
  expect(readingClock(3_200, 10_000)).toEqual({ elapsed: '3 s', overdue: false, limit: '10 s' })
  expect(readingClock(10_000, 10_000)).toEqual({ elapsed: '10 s', overdue: true, limit: '10 s' })
})

test('a registry read is given one index read, one bundle download and one judgement', () => {
  expect(readingClock(REGISTRY_READ_LIMIT_MS - 1, REGISTRY_READ_LIMIT_MS).overdue).toBe(false)
  expect(readingClock(REGISTRY_READ_LIMIT_MS, REGISTRY_READ_LIMIT_MS)).toMatchObject({
    overdue: true,
    limit: '6 min',
  })
})
