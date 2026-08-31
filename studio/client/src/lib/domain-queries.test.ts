import { expect, test } from 'bun:test'

import {
  anatomyQueryOptions,
  bundleQueryOptions,
  layoutQueryOptions,
  visibilityQueryOptions,
} from './domain-queries'

test('domain query options keep cache identity and client-authoritative state policy together', () => {
  expect([...bundleQueryOptions('alpha').queryKey]).toEqual(['bundle', 'alpha'])
  expect([...anatomyQueryOptions('alpha').queryKey]).toEqual(['anatomy', 'alpha'])
  expect(layoutQueryOptions('alpha')).toMatchObject({
    queryKey: ['layout', 'alpha'],
    staleTime: Number.POSITIVE_INFINITY,
  })
  expect(visibilityQueryOptions('alpha')).toMatchObject({
    queryKey: ['visibility', 'alpha'],
    staleTime: Number.POSITIVE_INFINITY,
  })
})
