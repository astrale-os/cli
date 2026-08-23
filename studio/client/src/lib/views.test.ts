import type { DomainAnatomy, IrClass, IrView, StudioSchemaBundle } from '@shared/types'

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

const localClass: IrClass = {
  type: 'node',
  name: 'Issue',
  origin: 'example.test',
  ref: { origin: 'example.test', kind: 'class', name: 'Issue' },
  properties: {},
  methods: {},
}

function bundle(
  views: Record<string, IrView>,
  classes: Record<string, IrClass> = {},
): StudioSchemaBundle {
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
      classes,
      importsByKey: {},
      importedClassesByKey: {},
      functions: {},
      views,
      policies: {},
      dependencies: [],
      core: {},
    },
    overlay: {
      origin: 'example.test',
      requires: [],
      crossDomainImports: [],
      mixins: [],
      handlerLinks: [],
      sourceSpans: {},
      annotations: [],
    },
    extractedAt: '2026-08-23T00:00:00.000Z',
  } satisfies StudioSchemaBundle
}

test('accepts an SDK frontend route without a client-local route registry', () => {
  expect(
    buildViewsModel(
      anatomy,
      bundle({
        dashboard: { name: 'dashboard', target: { kind: 'domain' }, auth: 'required' },
      }),
    ).all[0]?.drift,
  ).toBe('ok')
})

test('treats the canonical Domain target as authoritative over source metadata', () => {
  const stale = {
    ...anatomy,
    views: [{ ...anatomy.views[0], viewFor: 'MissingClass' }],
  } satisfies DomainAnatomy

  expect(
    buildViewsModel(
      stale,
      bundle({
        dashboard: { name: 'dashboard', target: { kind: 'domain' }, auth: 'required' },
      }),
    ).all[0],
  ).toMatchObject({ boundClasses: [], unbound: true, drift: 'ok' })
})

test('reports a source frontend route that has no canonical View declaration', () => {
  expect(buildViewsModel(anatomy, bundle({})).all[0]?.drift).toBe('missing-impl')
})

test('resolves a local Class target through its exact canonical ref', () => {
  const targeted = {
    ...anatomy,
    views: [{ slug: 'dashboard', kind: 'spa', mount: '/ui/dashboard' }],
  } satisfies DomainAnatomy
  const model = buildViewsModel(
    targeted,
    bundle(
      {
        dashboard: {
          name: 'dashboard',
          auth: 'required',
          target: {
            kind: 'definition',
            definitions: [{ origin: 'example.test', kind: 'class', name: 'Issue' }],
          },
        },
      },
      { Issue: localClass },
    ),
  )
  expect(model.all[0]).toMatchObject({ boundClass: 'Issue', unbound: false, drift: 'ok' })
})

test('resolves an imported Class exactly without aliasing it into the local namespace', () => {
  const imported = { origin: 'kernel.astrale.ai', kind: 'class', name: 'Identity' } as const
  const input = bundle({
    dashboard: {
      name: 'dashboard',
      auth: 'required',
      target: { kind: 'definition', definitions: [imported] },
    },
  })
  input.ir!.importsByKey['kernel.astrale.ai:class.Identity'] = {
    origin: imported.origin,
    ref: imported,
    key: 'kernel.astrale.ai:class.Identity',
  }

  const model = buildViewsModel(anatomy, input)
  expect(model.all[0]).toMatchObject({
    boundClass: null,
    boundClasses: [],
    unbound: true,
    drift: 'ok',
  })
  expect(model.byClass.has('Identity')).toBe(false)
})
