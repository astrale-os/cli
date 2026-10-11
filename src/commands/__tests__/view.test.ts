import type { ResolvedView } from '@astrale-os/shell'

import { Path } from '@astrale-os/sdk/graph/path'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { captureProcess, ExitError } from './fixtures/process'

const viewsForMock = mock(async (_target: unknown): Promise<unknown> => ({ views: [] }))
const bundleMock = mock(async (_origin: unknown): Promise<unknown> => installedDomain)
const abMock = mock(async (_args: string[]) => ({
  ok: true,
  data: { snapshot: '- button "Ready" [ref=e1]' },
  error: null,
}))
const findAgentBrowserMock = mock(async () => '/usr/bin/agent-browser' as string | null)

const io = captureProcess()

mock.module('../../connection', () => ({
  createPathCall: (target: string, input: unknown) => ({ target, input }),
  expandSelfInPath: async (path: string) => ({ path }),
  runKernelCommand: mock(async () => undefined),
  withClientSession: async (
    _opts: unknown,
    run: (ctx: {
      session: { viewsFor: typeof viewsForMock; schema: { bundle: typeof bundleMock } }
      target: { url: string; kernelIssuer: string }
    }) => Promise<unknown>,
  ) =>
    run({
      session: { viewsFor: viewsForMock, schema: { bundle: bundleMock } },
      target: { url: 'https://kernel.test', kernelIssuer: 'https://kernel.test' },
    }),
}))

mock.module('../../lib/browser/agent-browser', () => ({
  ab: abMock,
  AGENT_BROWSER_REPO: 'vercel-labs/agent-browser',
  BROWSER_DIR: '/tmp/astrale-browser',
  findAgentBrowser: findAgentBrowserMock,
}))

beforeEach(() => {
  viewsForMock.mockClear()
  bundleMock.mockClear()
  abMock.mockClear()
  findAgentBrowserMock.mockClear()
})

const ORIGIN = 'ai-gateway.astrale.ai'
const route = (name: string, handshake: 'shell' | 'none', seed: string) =>
  ({
    key: `${ORIGIN}:view.${name}`,
    href: `https://${ORIGIN}/ui/${name}`,
    handshake,
    issuer: `https://${ORIGIN}`,
    release: `sha256:${seed.repeat(64)}`,
    revision: `sha256:${seed.repeat(64)}`,
    declaration: { target: { kind: 'domain' as const } },
  }) as unknown as ResolvedView['route']
const resolved = [route('chat', 'shell', 'a'), route('model', 'none', 'c')] as const

/** The installed bundle of the Domain: both Views, bound to the second one's release. */
const installedDomain = {
  domain: {
    origin: ORIGIN,
    revision: resolved[1].revision,
    release: {
      origin: ORIGIN,
      identity: { issuer: resolved[1].issuer, subject: ORIGIN },
      revision: resolved[1].revision,
      digest: resolved[1].release,
    },
    bindings: {
      callables: [],
      views: resolved.map(({ key, href, handshake }) => ({ view: key, href, handshake })),
    },
  },
  bundle: {
    root: {
      views: Object.fromEntries(
        ['chat', 'model'].map((name, index) => [
          name,
          { ref: { origin: ORIGIN, kind: 'view', name }, ...resolved[index]!.declaration },
        ]),
      ),
    },
  },
}

describe('view session resolution', () => {
  test('reports a missing installed View through the structured command error boundary', async () => {
    const command = (await import('../view')).default
    await expect(
      command.action(`/:${ORIGIN}:view.absent`, { open: false, json: true }),
    ).rejects.toEqual(new ExitError(1))
    expect(io.failure()).toMatchObject({
      error: 'VIEW_NOT_FOUND',
      message: `View "absent" is not installed for ${ORIGIN}`,
    })
    expect(abMock).not.toHaveBeenCalled()
  })

  /** @evidence TEST-CLI-VIEW-PRESERVES-HOST-PROVENANCE */
  test('returns one exact Domain-bound placement without split mount coordinates', async () => {
    const { resolveSession } = await import('../view')
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))

    const result = await resolveSession('ai-gateway.astrale.ai', { view: 'chat' })

    expect(viewsForMock).toHaveBeenCalledTimes(1)
    expect(String(viewsForMock.mock.calls[0]?.[0])).toBe('/:ai-gateway.astrale.ai')
    expect(result.view).toEqual({
      target: Path.domain('ai-gateway.astrale.ai').raw,
      route: resolved[0],
    })
  })

  test('opens the Domain entrypoint when no View is named, and never guesses without one', async () => {
    const { resolveSession } = await import('../view')
    viewsForMock.mockImplementationOnce(async () => ({ entrypoint: resolved[1], views: resolved }))
    const result = await resolveSession('/:ai-gateway.astrale.ai', { json: true })
    expect(result.view).toEqual({ target: Path.domain(ORIGIN).raw, route: resolved[1] })

    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))
    await expect(resolveSession('ai-gateway.astrale.ai', { json: true })).rejects.toMatchObject({
      code: 'AMBIGUOUS_VIEW',
    })
  })

  test('lists every View of the Domain with its placement, without agent-browser', async () => {
    const view = await import('../view')
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))
    const result = await view.resolveSession('ai-gateway.astrale.ai', { list: true })
    expect(result.view).toBeUndefined()
    expect(result.candidates).toEqual([
      expect.objectContaining({
        target: '/:ai-gateway.astrale.ai',
        route: resolved[0],
        path: '/:ai-gateway.astrale.ai:view.chat',
        url: 'https://ai-gateway.astrale.ai/ui/chat',
        name: 'chat',
        handshake: 'shell',
      }),
      expect.objectContaining({ route: resolved[1], handshake: 'none' }),
    ])

    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))
    await (view.default.action as (spec: string, opts: { list: boolean }) => Promise<void>)(
      'ai-gateway.astrale.ai',
      { list: true },
    )
    expect(findAgentBrowserMock).not.toHaveBeenCalled()
    expect(abMock).not.toHaveBeenCalled()
  })

  test('resolves an explicit Domain ViewPath from its installed bundle, host included', async () => {
    const { resolveSession } = await import('../view')
    const host = { navigation: { external: { origins: ['https://provider.example'] } } }
    const views = installedDomain.domain.bindings.views.map((binding) =>
      binding.view.endsWith(':view.model') ? { ...binding, host } : binding,
    )
    bundleMock.mockImplementationOnce(async () => ({
      ...installedDomain,
      domain: { ...installedDomain.domain, bindings: { callables: [], views } },
    }))

    const result = await resolveSession('/:ai-gateway.astrale.ai:view.model', {})

    expect(bundleMock).toHaveBeenCalledWith('ai-gateway.astrale.ai')
    expect(viewsForMock).not.toHaveBeenCalled()
    expect(result.view).toEqual({
      target: Path.domain(ORIGIN).raw,
      route: { ...resolved[1], host },
    })
  })

  test('refuses a node path: Views belong to their Domain', async () => {
    const { resolveSession } = await import('../view')

    for (const spec of ['@model-id', '/models/gpt']) {
      await expect(resolveSession(spec, {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
    expect(viewsForMock).not.toHaveBeenCalled()
    expect(bundleMock).not.toHaveBeenCalled()
  })
})

describe('view capture timing', () => {
  test('settles the view before taking a screenshot', async () => {
    const { runSnapshotExtras } = await import('../view')

    await runSnapshotExtras({ screenshot: '/tmp/view.png' })

    const commands = abMock.mock.calls.map(([args]) => args[0])
    expect(commands.at(-1)).toBe('screenshot')
    expect(commands.slice(0, -1).every((command) => command === 'snapshot')).toBe(true)
    expect(commands.length).toBeGreaterThan(2)
  })
})

describe('view session runtime', () => {
  test('builds one serve config with the admitted origin grant and allowed identities', async () => {
    const { createViewServeConfig } = await import('../view')
    const target = { url: 'https://kernel.test', kernelIssuer: 'https://kernel.test' }
    const record = {
      id: 'v-proof',
      pid: 0,
      port: 4419,
      nonce: 'proof',
      pageUrl: 'http://127.0.0.1:4419/s/proof/',
      view: { target: Path.parse(`/:${ORIGIN}`).raw, route: resolved[0] },
      createdAt: '2026-08-26T00:00:00.000Z',
    }

    const config = createViewServeConfig(
      record,
      { allowExternalOrigin: ['https://connect.nango.dev/'] },
      target,
    )

    expect(config).toMatchObject({
      session: record,
      externalOrigins: ['https://connect.nango.dev'],
      proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true },
    })
    expect(config.identities).toBeUndefined()
    const named = { ...record, identity: 'alice' }
    expect(
      createViewServeConfig(named, { allowIdentity: ['bob', 'alice', 'bob'] }, target).identities,
    ).toEqual(['alice', 'bob'])
    expect(() =>
      createViewServeConfig(named, { allowIdentity: ['bob'], creds: 'opaque' }, target),
    ).toThrow('requires a named CLI identity')
  })

  test('spawns the detached server from a compiled executable without its virtual Bun entry', async () => {
    const { resolveServeRuntime, viewServeInvocation } = await import('../view')

    const runtime = await resolveServeRuntime({
      executable: '/opt/astrale/bin/astrale',
      entry: '/$bunfs/root/astrale',
      exists: () => true,
      find: async () => '/usr/bin/node',
    })
    expect(runtime).toEqual({
      file: '/opt/astrale/bin/astrale',
      args: [],
    })
    expect(viewServeInvocation(runtime, '/tmp/view.config.json')).toEqual({
      file: '/opt/astrale/bin/astrale',
      args: ['__view-serve', '--config', '/tmp/view.config.json'],
    })
  })
})
