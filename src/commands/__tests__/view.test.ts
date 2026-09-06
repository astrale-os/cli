import type { ResolvedView } from '@astrale-os/shell'

import { Path } from '@astrale-os/sdk/graph/path'
import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

const viewsForMock = mock(async (_target: unknown): Promise<unknown> => ({ views: [] }))
const bundleMock = mock(async (_origin: unknown): Promise<unknown> => installedDomain)
const abMock = mock(async (_args: string[]) => ({
  ok: true,
  data: { snapshot: '- button "Ready" [ref=e1]' },
  error: null,
}))
const findAgentBrowserMock = mock(async () => '/usr/bin/agent-browser' as string | null)

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

mock.module('../../lib/browser', () => ({
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

const route = (value: unknown) => value as ResolvedView['route']

const resolved = [
  route({
    key: 'ai-gateway.astrale.ai:view.chat',
    href: 'https://ai-gateway.astrale.ai/ui/chat',
    handshake: 'shell' as const,
    issuer: 'https://ai-gateway.astrale.ai',
    etag: `sha256:${'a'.repeat(64)}`,
    revision: `sha256:${'b'.repeat(64)}`,
    declaration: {
      target: {
        kind: 'definition' as const,
        definitions: [{ origin: 'ai-gateway.astrale.ai', kind: 'class' as const, name: 'Model' }],
      },
    },
  }),
  route({
    key: 'ai-gateway.astrale.ai:view.model',
    href: 'https://ai-gateway.astrale.ai/ui/model',
    handshake: 'none' as const,
    issuer: 'https://ai-gateway.astrale.ai',
    etag: `sha256:${'c'.repeat(64)}`,
    revision: `sha256:${'d'.repeat(64)}`,
    declaration: { target: { kind: 'domain' as const } },
  }),
]

const installedDomain = {
  domain: {
    origin: 'ai-gateway.astrale.ai',
    revision: resolved[1].revision,
    publication: {
      origin: 'ai-gateway.astrale.ai',
      identity: {
        issuer: resolved[1].issuer,
        subject: 'ai-gateway.astrale.ai',
      },
      revision: resolved[1].revision,
      etag: resolved[1].etag,
    },
    bindings: {
      callables: [],
      views: resolved.map(({ key, href, handshake, iframe }) => ({
        view: key,
        href,
        handshake,
        ...(iframe === undefined ? {} : { iframe }),
      })),
    },
  },
  bundle: {
    root: {
      views: {
        chat: {
          ref: { origin: 'ai-gateway.astrale.ai', kind: 'view', name: 'chat' },
          ...resolved[0].declaration,
        },
        model: {
          ref: { origin: 'ai-gateway.astrale.ai', kind: 'view', name: 'model' },
          ...resolved[1].declaration,
        },
      },
    },
  },
}

describe('view session resolution', () => {
  test('reports a missing installed View through the structured command error boundary', async () => {
    const command = (await import('../view')).default
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exited = new Error('fixture exit')
    const exit = spyOn(process, 'exit').mockImplementation(() => {
      throw exited
    })
    try {
      await expect(
        command.action('/:ai-gateway.astrale.ai:view.absent', {
          open: false,
          json: true,
        }),
      ).rejects.toBe(exited)
      expect(exit).toHaveBeenCalledWith(1)
      expect(stderr).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(stderr.mock.calls[0]![0]))).toMatchObject({
        error: 'VIEW_NOT_FOUND',
        message: 'View "absent" is not installed for ai-gateway.astrale.ai',
      })
      expect(abMock).not.toHaveBeenCalled()
    } finally {
      exit.mockRestore()
      stderr.mockRestore()
    }
  })

  test('does not expose local development or legacy placement overrides', async () => {
    const command = (await import('../view')).default
    const flags = command.options?.map((option) => option.flags) ?? []

    expect(flags).not.toContain('--development-local-url <origin>')
    expect(flags).not.toContain('--view-url <url>')
    expect(flags).not.toContain('--handshake <mode>')
  })

  /** @evidence TEST-CLI-VIEW-PRESERVES-HOST-PROVENANCE */
  test('returns one exact target-bound placement without split mount coordinates', async () => {
    const { resolveSession } = await import('../view')
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))

    const result = await resolveSession('@model-id', { view: 'chat' })

    expect(viewsForMock).toHaveBeenCalledTimes(1)
    expect(String(viewsForMock.mock.calls[0]?.[0])).toBe('@model-id')
    expect(result.view).toEqual({ target: Path.parse('@model-id').raw, route: resolved[0] })
    expect(result.view).not.toHaveProperty('url')
    expect(result.view).not.toHaveProperty('functionId')
    expect(result.view).not.toHaveProperty('handshake')
  })

  test('lists every candidate with its complete placement provenance', async () => {
    const { resolveSession } = await import('../view')
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))

    const result = await resolveSession('@model-id', { list: true })

    expect(result.view).toBeUndefined()
    expect(result.candidates).toEqual([
      expect.objectContaining({
        target: '@model-id',
        route: resolved[0],
        id: 'ai-gateway.astrale.ai:view.chat',
        path: '/:ai-gateway.astrale.ai:view.chat',
        url: 'https://ai-gateway.astrale.ai/ui/chat',
        name: 'chat',
        handshake: 'shell',
        origin: 'class',
      }),
      expect.objectContaining({
        target: '@model-id',
        route: resolved[1],
        id: 'ai-gateway.astrale.ai:view.model',
        handshake: 'none',
        origin: 'self',
      }),
    ])
  })

  test('lists candidates without consulting agent-browser', async () => {
    const command = (await import('../view')).default
    const action = command.action as unknown as (
      spec: string,
      opts: { list: boolean },
    ) => Promise<void>
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))

    await action('@model-id', { list: true })

    expect(viewsForMock).toHaveBeenCalledTimes(1)
    expect(findAgentBrowserMock).not.toHaveBeenCalled()
    expect(abMock).not.toHaveBeenCalled()
  })

  test('resolves an explicit Domain ViewPath from its installed bundle without reading a node', async () => {
    const { resolveSession } = await import('../view')

    const result = await resolveSession('/:ai-gateway.astrale.ai:view.model', {})

    expect(bundleMock).toHaveBeenCalledWith('ai-gateway.astrale.ai')
    expect(viewsForMock).not.toHaveBeenCalled()
    expect(result.view).toEqual({
      target: Path.parse('/:ai-gateway.astrale.ai').raw,
      route: resolved[1],
    })
  })

  test('keeps explicit target resolution on View.resolve', async () => {
    const { resolveSession } = await import('../view')
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))

    const result = await resolveSession('/:ai-gateway.astrale.ai:view.chat', {
      target: '@model-id',
    })

    expect(bundleMock).not.toHaveBeenCalled()
    expect(String(viewsForMock.mock.calls[0]?.[0])).toBe('@model-id')
    expect(result.view).toEqual({ target: Path.parse('@model-id').raw, route: resolved[0] })
  })

  test('requires a target for an installed definition view', async () => {
    const { resolveSession } = await import('../view')

    await expect(resolveSession('/:ai-gateway.astrale.ai:view.chat', {})).rejects.toMatchObject({
      code: 'VIEW_TARGET_REQUIRED',
    })
    expect(viewsForMock).not.toHaveBeenCalled()
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
  test('builds one serve config with the admitted operator origin grant', async () => {
    const { createViewServeConfig } = await import('../view')
    const record = {
      id: 'v-proof',
      pid: 0,
      port: 4419,
      nonce: 'proof',
      pageUrl: 'http://127.0.0.1:4419/s/proof/',
      view: { target: Path.parse('/:ai-gateway.astrale.ai').raw, route: resolved[0] },
      createdAt: '2026-08-26T00:00:00.000Z',
    }

    const config = createViewServeConfig(
      record,
      { allowExternalOrigin: ['https://connect.nango.dev/'] },
      { url: 'https://kernel.test', kernelIssuer: 'https://kernel.test' },
    )

    expect(config.session).toBe(record)
    expect(config).not.toHaveProperty('transport')
    expect(config.externalOrigins).toEqual(['https://connect.nango.dev'])
    expect(config.identities).toBeUndefined()
    const named = { ...record, identity: 'alice' }
    const target = { url: 'https://kernel.test', kernelIssuer: 'https://kernel.test' }
    expect(
      createViewServeConfig(named, { allowIdentity: ['bob', 'alice', 'bob'] }, target).identities,
    ).toEqual(['alice', 'bob'])
    expect(() =>
      createViewServeConfig(named, { allowIdentity: ['bob'], creds: 'opaque' }, target),
    ).toThrow('requires a named CLI identity')
    expect(config.proxy).toEqual({
      kernelUrl: 'https://kernel.test',
      issuer: 'https://kernel.test',
      caFile: undefined,
      direct: true,
    })
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
