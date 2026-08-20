import type { DomainAnatomy, StudioSchemaBundle } from '@shared/types'

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
  views: [{ slug: 'dashboard', kind: 'spa', mount: '/ui/dashboard', auth: 'required' }],
  client: { routes: {}, shell: [], features: [], present: true },
  env: [],
  detectedIntegrations: [],
} satisfies DomainAnatomy

const bundle = (canonical: boolean) =>
  ({
    depsInstalled: true,
    ir: {
      classes: {},
      views: canonical
        ? { dashboard: { name: 'dashboard', target: { kind: 'domain' }, auth: 'required' } }
        : undefined,
    },
  }) as StudioSchemaBundle

test('accepts a current SDK frontend route without a legacy client ROUTES registry', () => {
  expect(buildViewsModel(anatomy, bundle(true)).all[0]?.drift).toBe('ok')
})

test('treats a canonical Domain target as authoritative over stale viewFor metadata', () => {
  const stale = {
    ...anatomy,
    views: [{ ...anatomy.views[0], viewFor: 'MissingLegacyClass' }],
  } satisfies DomainAnatomy

  expect(buildViewsModel(stale, bundle(true)).all[0]).toMatchObject({
    boundClasses: [],
    unbound: true,
    drift: 'ok',
  })
})

test('keeps legacy missing-route detection', () => {
  expect(buildViewsModel(anatomy, bundle(false)).all[0]?.drift).toBe('missing-impl')
})

test('uses canonical View targets when static anatomy cannot follow an imported declaration', () => {
  const targeted = {
    ...anatomy,
    views: [{ slug: 'dashboard', kind: 'spa', mount: '/ui/dashboard' }],
  } satisfies DomainAnatomy
  const canonical = {
    depsInstalled: true,
    ir: {
      domain: 'example.test',
      classes: { Issue: { type: 'node', name: 'Issue', properties: {}, methods: {} } },
      interfaces: {},
      imports: {},
      views: {
        dashboard: {
          name: 'dashboard',
          auth: 'required',
          target: {
            kind: 'definition',
            definitions: [{ origin: 'example.test', kind: 'class', name: 'Issue' }],
          },
        },
      },
    },
  } as unknown as StudioSchemaBundle

  expect(buildViewsModel(targeted, canonical).all[0]).toMatchObject({
    boundClass: 'Issue',
    unbound: false,
    drift: 'ok',
  })
})

test('resolves an imported interface View target by exact ref', () => {
  const targeted = {
    ...anatomy,
    views: [{ slug: 'dashboard', kind: 'spa', mount: '/ui/dashboard' }],
  } satisfies DomainAnatomy
  const canonical = {
    depsInstalled: true,
    ir: {
      domain: 'example.test',
      classes: {
        Identity: { type: 'node', name: 'Identity', properties: {}, methods: {} },
      },
      interfaces: {},
      imports: {},
      importsByKey: {
        'kernel.astrale.ai:class.Identity': {
          origin: 'kernel.astrale.ai',
          definition: 'class',
          ref: { origin: 'kernel.astrale.ai', kind: 'class', name: 'Identity' },
          key: 'kernel.astrale.ai:class.Identity',
        },
        'kernel.astrale.ai:interface.Identity': {
          origin: 'kernel.astrale.ai',
          definition: 'interface',
          ref: { origin: 'kernel.astrale.ai', kind: 'interface', name: 'Identity' },
          key: 'kernel.astrale.ai:interface.Identity',
        },
      },
      views: {
        dashboard: {
          name: 'dashboard',
          auth: 'required',
          target: {
            kind: 'definition',
            definitions: [{ origin: 'kernel.astrale.ai', kind: 'interface', name: 'Identity' }],
          },
        },
      },
    },
  } as unknown as StudioSchemaBundle

  expect(buildViewsModel(targeted, canonical).all[0]).toMatchObject({
    boundClass: null,
    boundClasses: [],
    unbound: true,
    drift: 'ok',
  })
  expect(buildViewsModel(targeted, canonical).byClass.has('Identity')).toBe(false)
})
