import { describe, expect, test } from 'bun:test'

import type {
  RememberedViewTarget,
  StudioSchemaBundle,
  ViewInfo,
  ViewTargetCandidate,
} from '../../shared/types'

import {
  conciseCliFailure,
  readyViewSession,
  reconcileRememberedTarget,
  targetDefinition,
  targetFromRow,
  viewDefinitionBindings,
  viewSessionArgs,
} from './views'

describe('view session command', () => {
  test('opens the installed ViewPath without rejected placement overrides', () => {
    const args = viewSessionArgs('issues.astrale.ai', 'issue-detail', 'staging', '@issue-1')
    expect(args).toEqual([
      'view',
      '/:issues.astrale.ai:view.issue-detail',
      '--target',
      '@issue-1',
      '--no-open',
      '--json',
      '-i',
      'staging',
    ])
    expect(args).not.toContain('--view-url')
    expect(args).not.toContain('--handshake')
  })

  test('omits --target for a standalone view', () => {
    expect(viewSessionArgs('issues.astrale.ai', 'dashboard', 'local')).toEqual([
      'view',
      '/:issues.astrale.ai:view.dashboard',
      '--no-open',
      '--json',
      '-i',
      'local',
    ])
  })

  test('preserves canonical interface View target coordinates', () => {
    const view = { slug: 'users', kind: 'unknown' } satisfies ViewInfo
    const bundle = {
      ir: {
        views: {
          users: {
            name: 'users',
            auth: 'required',
            target: {
              kind: 'definition',
              definitions: [{ origin: 'kernel.astrale.ai', kind: 'interface', name: 'Identity' }],
            },
          },
        },
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      {
        className: 'Identity',
        classOrigin: 'kernel.astrale.ai',
        kind: 'interface',
      },
    ])
    expect(targetDefinition('Identity', 'kernel.astrale.ai', 'interface')).toBe(
      '/:kernel.astrale.ai:interface.Identity',
    )
  })

  test('preserves every exact canonical homonym and ignores short-name metadata', () => {
    const view = {
      slug: 'named',
      kind: 'unknown',
      viewFor: 'WrongLegacyTarget',
    } satisfies ViewInfo
    const bundle = {
      ir: {
        views: {
          named: {
            name: 'named',
            auth: 'required',
            target: {
              kind: 'definition',
              definitions: [
                { origin: 'directory.example.dev', kind: 'interface', name: 'Named' },
                { origin: 'people.example.dev', kind: 'interface', name: 'Named' },
                { origin: 'catalog.example.dev', kind: 'class', name: 'Named' },
              ],
            },
          },
        },
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      { className: 'Named', classOrigin: 'directory.example.dev', kind: 'interface' },
      { className: 'Named', classOrigin: 'people.example.dev', kind: 'interface' },
      { className: 'Named', classOrigin: 'catalog.example.dev', kind: 'class' },
    ])
  })

  test('treats an exact Domain target as authoritative over legacy viewFor', () => {
    const view = { slug: 'home', kind: 'unknown', viewFor: 'User' } satisfies ViewInfo
    const bundle = {
      ir: {
        views: {
          home: { name: 'home', auth: 'required', target: { kind: 'domain' } },
        },
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([])
  })

  test('uses every exact fallback candidate across origin and definition-kind collisions', () => {
    const view = { slug: 'legacy-named', kind: 'unknown', viewFor: 'Named' } satisfies ViewInfo
    const bundle = {
      ir: {
        domain: 'shell.astrale.ai',
        views: {},
        classes: {
          Named: {
            origin: 'shell.astrale.ai',
            ref: { origin: 'shell.astrale.ai', kind: 'class', name: 'Named' },
          },
        },
        interfaces: {
          Named: {
            origin: 'shell.astrale.ai',
            ref: { origin: 'shell.astrale.ai', kind: 'interface', name: 'Named' },
          },
        },
        imports: {
          Named: { origin: 'legacy.invalid', definition: 'class' },
        },
        importsByKey: {
          'directory.example.dev:interface.Named': {
            origin: 'directory.example.dev',
            definition: 'interface',
          },
          'catalog.example.dev:class.Named': {
            origin: 'catalog.example.dev',
            definition: 'class',
          },
        },
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, bundle)).toEqual([
      { className: 'Named', classOrigin: 'shell.astrale.ai', kind: 'class' },
      { className: 'Named', classOrigin: 'shell.astrale.ai', kind: 'interface' },
      { className: 'Named', classOrigin: 'directory.example.dev', kind: 'interface' },
      { className: 'Named', classOrigin: 'catalog.example.dev', kind: 'class' },
    ])
  })

  test('uses the short-name import only for legacy bundles without an exact index', () => {
    const view = { slug: 'legacy-users', kind: 'unknown', viewFor: 'User' } satisfies ViewInfo
    const legacy = {
      ir: {
        domain: 'shell.astrale.ai',
        views: {},
        classes: {},
        interfaces: {},
        imports: {
          User: { origin: 'accounts.example.dev', definition: 'interface' },
        },
      },
    } as unknown as StudioSchemaBundle
    const exact = {
      ir: {
        ...legacy.ir,
        importsByKey: {},
      },
    } as unknown as StudioSchemaBundle

    expect(viewDefinitionBindings('shell.astrale.ai', view, legacy)).toEqual([
      { className: 'User', classOrigin: 'accounts.example.dev', kind: 'interface' },
    ])
    expect(viewDefinitionBindings('shell.astrale.ai', view, exact)).toEqual([])
  })

  test('reads the verified placement URL from the current CLI session route', () => {
    expect(
      readyViewSession(
        {
          session: {
            id: 'v-a1b2',
            pageUrl: 'http://127.0.0.1:4419/s/nonce/',
            view: { route: { href: 'https://issues.example/ui/issue' } },
          },
        },
        null,
      ),
    ).toEqual({
      status: 'ready',
      sessionId: 'v-a1b2',
      pageUrl: 'http://127.0.0.1:4419/s/nonce/',
      viewUrl: 'https://issues.example/ui/issue',
      target: null,
    })
    expect(
      readyViewSession(
        {
          session: {
            id: 'v-old',
            pageUrl: 'http://127.0.0.1:4419/s/old/',
            view: { url: 'https://legacy.invalid/view' },
          },
        } as never,
        null,
      ),
    ).toBeNull()
  })
})

test('reduces CLI stack output to the actionable kernel failure', () => {
  expect(
    conciseCliFailure(
      `275 |   if (code === KERNEL_ERROR_CODES.INVALID_REQUEST)\n276 |\nPermissionDeniedError: Permission denied: READ on /:issues.astrale.ai:view.issue\n details: {\n  method: \"View:resolve\"\n}\n at mapServerError (errors.ts:280:61)\nBun v1.3.14`,
    ),
  ).toBe('PermissionDeniedError: Permission denied: READ on /:issues.astrale.ai:view.issue')
})

describe('target candidates', () => {
  const remembered: RememberedViewTarget = {
    id: 'gone-id',
    className: 'Issue',
    classOrigin: 'issues.astrale.ai',
    label: 'Deleted issue',
  }
  const candidate: ViewTargetCandidate = {
    id: 'live-id',
    ref: '@live-id',
    className: 'Issue',
    classOrigin: 'issues.astrale.ai',
    label: 'Live issue',
  }

  test('turns a missing remembered node into an explicit stale selection', () => {
    expect(reconcileRememberedTarget(remembered, [candidate])).toEqual({
      selected: null,
      stale: remembered,
    })
    expect(reconcileRememberedTarget({ ...remembered, id: 'live-id' }, [candidate])).toEqual({
      selected: candidate,
      stale: null,
    })
  })

  test('builds friendly candidates from generic qualified node properties', () => {
    expect(
      targetFromRow(
        {
          id: 'iss-1',
          props: {
            'kernel.astrale.ai:interface.Named.property.name': 'Broken authorization badge',
            'kernel.astrale.ai:interface.Descriptable.property.description': 'Studio regression',
            'kernel.astrale.ai:interface.Statused.property.status': 'open',
          },
        },
        'Issue',
        'issues.astrale.ai',
      ),
    ).toEqual({
      id: 'iss-1',
      ref: '@iss-1',
      className: 'Issue',
      classOrigin: 'issues.astrale.ai',
      label: 'Broken authorization badge',
      description: 'Studio regression',
      status: 'open',
    })
  })

  test('addresses exact class instances through a canonical Definition source', () => {
    expect(targetDefinition('Issue', 'issues.astrale.ai')).toBe('/:issues.astrale.ai:class.Issue')
  })
})
