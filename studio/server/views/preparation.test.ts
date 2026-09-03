import { afterEach, expect, test } from 'bun:test'

import type { ViewTargetResult } from '../../shared/types'

import { clearViewPreparations, readViewPreparation, rememberViewPreparation } from './preparation'

const targets: ViewTargetResult = {
  status: 'available',
  items: [],
  selected: null,
  stale: null,
  truncated: false,
}

afterEach(clearViewPreparations)

test('binds a preparation to the exact workspace, Domain, and View route', () => {
  const preparation = rememberViewPreparation(
    {
      root: '/workspace',
      origin: 'issues.example.dev',
      slug: 'issue-detail',
      instance: 'staging',
      targetRequired: true,
      targets,
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

test('expires old launch context instead of reusing stale target candidates', () => {
  const preparation = rememberViewPreparation(
    {
      root: '/workspace',
      origin: 'issues.example.dev',
      slug: 'issue-detail',
      instance: 'staging',
      targetRequired: true,
      targets,
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
