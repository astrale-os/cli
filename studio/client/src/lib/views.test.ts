import type { DomainAnatomy, IrView, StudioSchemaBundle } from '@shared/types'

import { expect, test } from 'bun:test'

import { buildViewsModel } from './views'

const anatomy = {
  overview: {
    origin: 'example.test',
    adapter: 'astrale',
    requires: [],
    astraleDeps: {},
    schemaDir: 'schema',
  },
  views: [{ slug: 'dashboard', kind: 'spa', mount: '/ui/dashboard' }],
  client: { routes: {}, shell: [], features: [], present: true },
  env: [],
  detectedIntegrations: [],
} satisfies DomainAnatomy

function bundle(views: Record<string, IrView>): StudioSchemaBundle {
  return {
    domainId: 'example',
    renderFingerprint: 'fixture',
    schemaMode: 'canonical-admitted',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      format: 'astrale.dsl',
      version: 'v1',
      domain: 'example.test',
      classes: {},
      importsByKey: {},
      importedClassesByKey: {},
      functions: {},
      views,
      policies: {},
      dependencies: [],
      core: {},
    },
    overlay: {
      handlerLinks: [],
      sourceSpans: {},
    },
    extractedAt: '2026-08-23T00:00:00.000Z',
  } satisfies StudioSchemaBundle
}

test('accepts an SDK frontend route without a client-local route registry', () => {
  expect(buildViewsModel(anatomy, bundle({ dashboard: { name: 'dashboard' } })).all[0]?.drift).toBe(
    'ok',
  )
})

test('reports a source frontend route that has no canonical View declaration', () => {
  expect(buildViewsModel(anatomy, bundle({})).all[0]?.drift).toBe('missing-impl')
})

test('binds no View to a Class: every View belongs to its Domain', () => {
  const model = buildViewsModel(anatomy, bundle({ dashboard: { name: 'dashboard' } }))
  expect(model.all[0]).toEqual({ ...anatomy.views[0], drift: 'ok' })
  expect(model).not.toHaveProperty('byClass')
})
