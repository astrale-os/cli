import { publishedDomainId } from '@shared/contracts/versions'
import { expect, test } from 'bun:test'

import { anatomy, bundle } from '@/schema-studio/__tests__/fixture'

import { buildViewsModel } from './views'

const reach = { status: 'none', reason: 'The Domain declares no frontend.' } as const
const dashboard = { slug: 'dashboard', kind: 'spa', mount: '/ui/dashboard', reach } as const

test('a frontend route is bound to the canonical View of the same name, or reported missing', () => {
  const declared = bundle({})
  declared.ir!.views = { dashboard: { name: 'dashboard' } }
  expect(buildViewsModel(anatomy([dashboard]), declared).all[0]).toEqual({
    ...dashboard,
    drift: 'ok',
  })
  expect(buildViewsModel(anatomy([dashboard]), bundle({})).all[0]?.drift).toBe('missing-impl')
})

test('a View the server sent no reading of states its code is unread, never that it reaches nothing', () => {
  const declared = bundle({})
  declared.ir!.views = { dashboard: { name: 'dashboard' } }
  const { reach: _, ...unread } = dashboard
  expect(buildViewsModel(anatomy([unread]), declared).all[0]?.reach).toEqual({
    status: 'unread',
    reason: 'The server sent no reading of this View’s code.',
  })
})

test('a Publication lists the Views its Schema declares, with no View code behind them', () => {
  const published = bundle({})
  published.domainId = publishedDomainId('issues.astrale.ai', '0.9.1')
  published.ir!.views = { application: { name: 'application', description: 'Every issue.' } }
  expect(buildViewsModel(anatomy([]), published)).toEqual({
    all: [
      {
        slug: 'application',
        kind: 'unknown',
        description: 'Every issue.',
        drift: 'ok',
        reach: {
          status: 'none',
          reason: 'A Publication carries its Schema only: no View code is read.',
        },
      },
    ],
    orphanRoutes: [],
    hasDrift: false,
  })
})
