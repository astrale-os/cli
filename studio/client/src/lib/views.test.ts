import { expect, test } from 'bun:test'

import { anatomy, bundle } from '@/schema-studio/__tests__/fixture'

import { buildViewsModel } from './views'

const dashboard = { slug: 'dashboard', kind: 'spa', mount: '/ui/dashboard' } as const

test('a frontend route is bound to the canonical View of the same name, or reported missing', () => {
  const declared = bundle({})
  declared.ir!.views = { dashboard: { name: 'dashboard' } }
  expect(buildViewsModel(anatomy([dashboard]), declared).all[0]).toEqual({
    ...dashboard,
    drift: 'ok',
  })
  expect(buildViewsModel(anatomy([dashboard]), bundle({})).all[0]?.drift).toBe('missing-impl')
})
