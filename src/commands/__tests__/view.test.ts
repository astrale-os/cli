import { beforeEach, describe, expect, mock, test } from 'bun:test'

const getMock = mock(async (_path: string) => ({ id: 'issue-id' }))
const clientCallMock = mock(async (): Promise<unknown> => {
  throw new Error('View:resolve must not run for a bare --view-url')
})
const abMock = mock(async (_args: string[]) => ({
  ok: true,
  data: { snapshot: '- button "Ready" [ref=e1]' },
  error: null,
}))

mock.module('../../kernel', () => ({
  bindGraph: () => ({ get: getMock }),
  expandSelfInPath: async (path: string) => ({ path }),
  resolveKernelTarget: mock(),
  withKernelClient: async (
    _opts: unknown,
    run: (ctx: { client: { call: typeof clientCallMock } }) => Promise<unknown>,
  ) => run({ client: { call: clientCallMock } }),
}))

mock.module('../../lib/browser', () => ({
  ab: abMock,
  AGENT_BROWSER_REPO: 'vercel-labs/agent-browser',
  BROWSER_DIR: '/tmp/astrale-browser',
  findAgentBrowser: mock(async () => '/usr/bin/agent-browser'),
}))

beforeEach(() => {
  getMock.mockClear()
  clientCallMock.mockClear()
  abMock.mockClear()
})

describe('view session resolution', () => {
  test('uses a bare --view-url target only as shell context', async () => {
    const { resolveSession } = await import('../view')
    const targetPath = '/users/user-1/issue-1'

    const result = await resolveSession(undefined, {
      viewUrl: 'http://127.0.0.1:5173/ui/issues',
      handshake: 'shell',
      target: targetPath,
    })

    expect(getMock).toHaveBeenCalledWith(targetPath)
    expect(clientCallMock).not.toHaveBeenCalled()
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
    const targetPath = '/domains/ai-gateway.astrale.ai/core/gemini-3-5-flash'
    const candidates = [
      {
        id: 'chat-id',
        path: '/domains/ai-gateway.astrale.ai/views/chat',
        url: 'https://ai-gateway.astrale.ai/ui/chat',
        origin: 'class' as const,
      },
      {
        id: 'model-id',
        path: '/domains/ai-gateway.astrale.ai/views/model',
        url: 'https://ai-gateway.astrale.ai/ui/model',
        origin: 'class' as const,
      },
    ]
    clientCallMock.mockImplementationOnce(async () => candidates)

    const result = await resolveSession(targetPath, { list: true })

    expect(result).toEqual({
      target: { id: 'issue-id', path: targetPath },
      candidates,
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
