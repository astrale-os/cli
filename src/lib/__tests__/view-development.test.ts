import type { MountedWindow, MountParams, ResolvedView, Shell } from '@astrale-os/shell'

import { defineApplication, defineFrontend, vite } from '@astrale-os/sdk/application'
import { compile } from '@astrale-os/sdk/deployment/build'
import { addressing, assemble } from '@astrale-os/sdk/deployment/release'
import { defineRuntime } from '@astrale-os/sdk/runtime'
import { defineSchema, view } from '@astrale-os/sdk/schema'
import { describe, expect, mock, test } from 'bun:test'

import { openDevelopmentView } from '../view/development/mount'
import {
  developmentLocalOrigin,
  proveDevelopmentViewTransport,
} from '../view/development/publication'
import { developmentTransportFor } from '../view/development/transport'
import { viewHostCapabilities } from '../view/host-capabilities'

const schema = defineSchema('view-development.example', {
  views: { inbox: view({}), detail: view({}) },
})
const runtime = defineRuntime<typeof schema>()({
  integrations: {},
  initialize: () => ({ providers: {} }),
  functions: [],
})
const deployed = assemble(
  compile(
    defineApplication({
      schema,
      runtime,
      frontend: defineFrontend({
        schema,
        source: vite(),
        entrypoint: 'inbox',
        routes: { inbox: '/ui/inbox', detail: '/ui/detail' },
      }),
    }),
  ),
  addressing('https://view-development.example'),
).publication

function resolved(name: 'inbox' | 'detail' = 'inbox'): ResolvedView {
  const binding = deployed.bindings.views.find((candidate) => candidate.view.endsWith(`.${name}`))!
  return {
    target: `/:${deployed.origin}` as ResolvedView['target'],
    route: {
      key: binding.view,
      declaration: { target: { kind: 'domain' } },
      href: binding.href,
      handshake: binding.handshake,
      issuer: deployed.identity.issuer,
      etag: deployed.etag,
      revision: deployed.schema.revision,
    },
  }
}

function changedRoute(change: Partial<ResolvedView['route']>): ResolvedView {
  const current = resolved()
  return { ...current, route: { ...current.route, ...change } }
}

describe('View development Publication proof', () => {
  test('derives one loopback document from one exact local Publication', async () => {
    const fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8787/.well-known/astrale/domain.json')
      expect(init?.redirect).toBe('error')
      return Response.json(deployed)
    })

    const transport = await proveDevelopmentViewTransport(
      resolved(),
      'http://127.0.0.1:8787',
      undefined,
      fetch,
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(transport).toEqual({
      href: 'http://127.0.0.1:8787/ui/inbox',
      issuer: deployed.identity.issuer,
      revision: deployed.schema.revision,
      etag: deployed.etag,
    })
  })

  test.each([
    'https://public.example',
    'http://0.0.0.0:8787',
    'http://localhost:8787/ui/inbox',
    'http://user:secret@localhost:8787',
    'ftp://localhost:8787',
  ])('rejects a non-loopback-origin input before fetch: %s', async (input) => {
    const fetch = mock(async () => Response.json(deployed))
    await expect(
      proveDevelopmentViewTransport(resolved(), input, undefined, fetch),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each([
    [
      'origin',
      {
        key: 'foreign.example:view.inbox' as ResolvedView['route']['key'],
      },
    ],
    [
      'issuer',
      {
        issuer: 'https://foreign.example' as ResolvedView['route']['issuer'],
      },
    ],
    [
      'revision',
      {
        revision: `sha256:${'0'.repeat(64)}` as ResolvedView['route']['revision'],
      },
    ],
    ['etag', { etag: `sha256:${'1'.repeat(64)}` as ResolvedView['route']['etag'] }],
    ['binding href', { href: 'https://view-development.example/ui/changed' }],
    ['binding handshake', { handshake: 'none' as const }],
  ])('rejects an exact %s mismatch', async (_name, change) => {
    await expect(
      proveDevelopmentViewTransport(
        changedRoute(change),
        'http://localhost:8787',
        undefined,
        async () => Response.json(deployed),
      ),
    ).rejects.toMatchObject({ code: 'VIEW_DEVELOPMENT_MISMATCH' })
  })

  test('rejects an unavailable or malformed local Publication', async () => {
    await expect(
      proveDevelopmentViewTransport(
        resolved(),
        'http://localhost:8787',
        undefined,
        async () => new Response(null, { status: 503 }),
      ),
    ).rejects.toThrow('503')
    await expect(
      proveDevelopmentViewTransport(resolved(), 'http://localhost:8787', undefined, async () =>
        Response.json({ format: 'not-a-publication' }),
      ),
    ).rejects.toThrow('invalid Domain Publication')
  })

  test('forwards cancellation to a local Publication fetch that never responds', async () => {
    const controller = new AbortController()
    const fetch = mock(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    const pending = proveDevelopmentViewTransport(
      resolved(),
      'http://localhost:8787',
      controller.signal,
      fetch,
    )

    controller.abort(new Error('development Publication deadline'))

    await expect(pending).rejects.toThrow('development Publication deadline')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('rejects drift anywhere in the fetched Publication under its retained ETag', async () => {
    const tampered = {
      ...deployed,
      bindings: {
        ...deployed.bindings,
        views: deployed.bindings.views.map((binding, index) =>
          index === 1
            ? { ...binding, href: 'https://view-development.example/ui/changed' }
            : binding,
        ),
      },
    }

    await expect(
      proveDevelopmentViewTransport(resolved(), 'http://localhost:8787', undefined, async () =>
        Response.json(tampered),
      ),
    ).rejects.toThrow('invalid Domain Publication')
  })

  test('reuses the origin for a nested View only under the same exact Publication', async () => {
    const witness = await proveDevelopmentViewTransport(
      resolved(),
      'http://[::1]:8787',
      undefined,
      async () => Response.json(deployed),
    )

    expect(developmentTransportFor(resolved('detail'), witness)?.href).toBe(
      'http://[::1]:8787/ui/detail',
    )
    expect(
      developmentTransportFor(
        changedRoute({
          issuer: 'https://foreign.example' as ResolvedView['route']['issuer'],
        }),
        witness,
      ),
    ).toBeUndefined()
    expect(
      developmentTransportFor(
        changedRoute({ etag: `sha256:${'f'.repeat(64)}` as ResolvedView['route']['etag'] }),
        witness,
      ),
    ).toBeUndefined()
    expect(
      developmentTransportFor(
        changedRoute({
          revision: `sha256:${'e'.repeat(64)}` as ResolvedView['route']['revision'],
        }),
        witness,
      ),
    ).toBeUndefined()
  })

  test('the viewer mount owner passes local transport only to same-Release Shell mounts', async () => {
    const witness = await proveDevelopmentViewTransport(
      resolved(),
      'http://127.0.0.1:8787',
      undefined,
      async () => Response.json(deployed),
    )
    const calls: unknown[] = []
    const mounted = { windowId: 'view-window' } as unknown as MountedWindow
    const shell: Pick<Shell, 'openView'> = {
      openView: async (params) => {
        calls.push(params)
        return mounted
      },
    }
    const common: Omit<MountParams, 'transport' | 'view'> = {
      host: {} as HTMLElement,
      capabilities: viewHostCapabilities([]),
    }

    await expect(
      openDevelopmentView(shell, { ...common, view: resolved('detail') }, witness),
    ).resolves.toBe(mounted)
    await openDevelopmentView(
      shell,
      {
        ...common,
        view: changedRoute({
          issuer: 'https://foreign.example' as ResolvedView['route']['issuer'],
        }),
      },
      witness,
    )

    expect(calls).toEqual([
      {
        ...common,
        view: resolved('detail'),
        transport: {
          ...witness,
          href: 'http://127.0.0.1:8787/ui/detail',
        },
      },
      {
        ...common,
        view: changedRoute({
          issuer: 'https://foreign.example' as ResolvedView['route']['issuer'],
        }),
        transport: undefined,
      },
    ])
  })

  test('normalizes accepted loopback spellings to one origin', () => {
    expect(developmentLocalOrigin('http://127.1:8787')).toBe('http://127.0.0.1:8787')
    expect(developmentLocalOrigin('https://localhost:8787/')).toBe('https://localhost:8787')
  })
})
