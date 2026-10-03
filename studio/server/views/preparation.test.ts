import { afterEach, expect, test } from 'bun:test'

import { clearViewPreparations, readViewPreparation, rememberViewPreparation } from './preparation'

afterEach(clearViewPreparations)

test('binds a preparation to the exact workspace, Domain, and View route', () => {
  const preparation = rememberViewPreparation(
    {
      root: '/workspace',
      origin: 'issues.example.dev',
      slug: 'issue-detail',
      instance: 'staging',
    },
    1000,
  )

  expect(preparation.id).toMatch(/^[0-9a-f]{24}$/)
  expect(
    readViewPreparation(
      preparation.id,
      { root: '/workspace', origin: 'issues.example.dev', slug: 'issue-detail' },
      1001,
    ),
  ).toEqual(preparation)
  expect(
    readViewPreparation(
      preparation.id,
      { root: '/other', origin: 'issues.example.dev', slug: 'issue-detail' },
      1001,
    ),
  ).toBeNull()
})

test('expires old launch context instead of reusing a stale instance', () => {
  const preparation = rememberViewPreparation(
    {
      root: '/workspace',
      origin: 'issues.example.dev',
      slug: 'issue-detail',
      instance: 'staging',
    },
    1000,
  )

  expect(
    readViewPreparation(
      preparation.id,
      { root: '/workspace', origin: 'issues.example.dev', slug: 'issue-detail' },
      preparation.expiresAt,
    ),
  ).toBeNull()
})
