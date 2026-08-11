import { beforeEach, describe, expect, mock, test } from 'bun:test'

const getMock = mock(async (_path: unknown) => ({ id: 'issue-id' }))
const viewsForMock = mock(async (): Promise<unknown> => {
  throw new Error('View:resolve must not run for a bare --view-url')
})
const abMock = mock(async (_args: string[]) => ({
  ok: true,
  data: { snapshot: '- button "Ready" [ref=e1]' },
  error: null,
}))

mock.module('../../connection', () => ({
  expandSelfInPath: async (path: string) => ({ path }),
  withHostSession: async (
    _opts: unknown,
    run: (ctx: {
      graph: { get: typeof getMock }
      host: { viewsFor: typeof viewsForMock }
      target: { url: string; issuer: string }
    }) => Promise<unknown>,
  ) =>
    run({
      graph: { get: getMock },
      host: { viewsFor: viewsForMock },
      target: { url: 'https://kernel.test', issuer: 'https://kernel.test' },
    }),
}))

mock.module('../../lib/browser', () => ({
  ab: abMock,
  AGENT_BROWSER_REPO: 'vercel-labs/agent-browser',
  BROWSER_DIR: '/tmp/astrale-browser',
  findAgentBrowser: mock(async () => '/usr/bin/agent-browser'),
}))

beforeEach(() => {
  getMock.mockClear()
  viewsForMock.mockClear()
  abMock.mockClear()
})

describe('view session resolution', () => {
  test('uses a bare --view-url target only as shell context', async () => {
    const { resolveSession } = await import('../view')
    const targetPath = '@issue-id'

    const result = await resolveSession(undefined, {
      viewUrl: 'http://127.0.0.1:5173/ui/issues',
      handshake: 'shell',
      target: targetPath,
    })

    expect(String(getMock.mock.calls[0]?.[0])).toBe(targetPath)
    expect(viewsForMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      view: {
        url: 'http://127.0.0.1:5173/ui/issues',
        functionId: 'dev-view',
        handshake: 'shell',
        name: 'dev',
      },
      target: { id: 'issue-id', path: targetPath },
      candidates: [],
    })
  })

  test('lists every candidate without requiring a view selection', async () => {
    const { resolveSession } = await import('../view')
    const targetPath = '@model-id'
    const resolved = [
      {
        key: 'ai-gateway.astrale.ai:view.chat',
        href: 'https://ai-gateway.astrale.ai/ui/chat',
        handshake: 'shell' as const,
        issuer: 'https://ai-gateway.astrale.ai',
        etag: `sha256:${'a'.repeat(64)}`,
        revision: `sha256:${'b'.repeat(64)}`,
        declaration: {
          target: { kind: 'definition' as const, definitions: [] },
          auth: 'required' as const,
        },
      },
      {
        key: 'ai-gateway.astrale.ai:view.model',
        href: 'https://ai-gateway.astrale.ai/ui/model',
        handshake: 'none' as const,
        issuer: 'https://ai-gateway.astrale.ai',
        etag: `sha256:${'c'.repeat(64)}`,
        revision: `sha256:${'d'.repeat(64)}`,
        declaration: { target: { kind: 'domain' as const }, auth: 'public' as const },
      },
    ]
    viewsForMock.mockImplementationOnce(async () => ({ views: resolved }))

    const result = await resolveSession(targetPath, { list: true })

    expect(result).toMatchObject({
      target: { id: 'issue-id', path: targetPath },
      candidates: [
        {
          id: 'ai-gateway.astrale.ai:view.chat',
          path: '/:ai-gateway.astrale.ai:view.chat',
          url: 'https://ai-gateway.astrale.ai/ui/chat',
          name: 'chat',
          handshake: 'shell',
          origin: 'class',
        },
        {
          id: 'ai-gateway.astrale.ai:view.model',
          path: '/:ai-gateway.astrale.ai:view.model',
          url: 'https://ai-gateway.astrale.ai/ui/model',
          name: 'model',
          handshake: 'none',
          origin: 'self',
        },
      ],
    })
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
