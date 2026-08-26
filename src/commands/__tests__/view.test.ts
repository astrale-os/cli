import type { ResolvedView } from '@astrale-os/shell'

import { Path } from '@astrale-os/sdk/graph/path'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const viewsForMock = mock(async (_target: unknown): Promise<unknown> => ({ views: [] }))
const abMock = mock(async (_args: string[]) => ({
  ok: true,
  data: { snapshot: '- button "Ready" [ref=e1]' },
  error: null,
}))

mock.module('../../connection', () => ({
  expandSelfInPath: async (path: string) => ({ path }),
  withClientSession: async (
    _opts: unknown,
    run: (ctx: {
      session: { viewsFor: typeof viewsForMock }
      target: { url: string; kernelIssuer: string }
    }) => Promise<unknown>,
  ) =>
    run({
      session: { viewsFor: viewsForMock },
      target: { url: 'https://kernel.test', kernelIssuer: 'https://kernel.test' },
    }),
}))

mock.module('../../lib/browser', () => ({
  ab: abMock,
  AGENT_BROWSER_REPO: 'vercel-labs/agent-browser',
  BROWSER_DIR: '/tmp/astrale-browser',
  findAgentBrowser: mock(async () => '/usr/bin/agent-browser'),
}))

beforeEach(() => {
  viewsForMock.mockClear()
  abMock.mockClear()
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
      auth: 'required' as const,
    },
  }),
  route({
    key: 'ai-gateway.astrale.ai:view.model',
    href: 'https://ai-gateway.astrale.ai/ui/model',
    handshake: 'none' as const,
    issuer: 'https://ai-gateway.astrale.ai',
    etag: `sha256:${'c'.repeat(64)}`,
    revision: `sha256:${'d'.repeat(64)}`,
    declaration: { target: { kind: 'domain' as const }, auth: 'public' as const },
  }),
]

describe('view session resolution', () => {
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

  test('resolves an explicit ViewPath against its Domain owner when no target is supplied', async () => {
    const { resolveSession } = await import('../view')
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))

    const result = await resolveSession('/:ai-gateway.astrale.ai:view.model', {})

    expect(String(viewsForMock.mock.calls[0]?.[0])).toBe('/:ai-gateway.astrale.ai')
    expect(result.view).toEqual({
      target: Path.parse('/:ai-gateway.astrale.ai').raw,
      route: resolved[1],
    })
  })

  test('retains legacy override flags but refuses to forge V2 placement provenance', async () => {
    const { rejectUnrepresentableOverrides } = await import('../view')

    expect(() => rejectUnrepresentableOverrides({ viewUrl: 'http://localhost:8787' })).toThrow(
      'verified View placement',
    )
    expect(() => rejectUnrepresentableOverrides({ handshake: 'none' })).toThrow(
      'verified View placement',
    )
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
