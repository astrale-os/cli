import { beforeEach, describe, expect, mock, test } from 'bun:test'

const getMock = mock(async (_path: string) => ({ id: 'issue-id' }))
const clientCallMock = mock(async (): Promise<unknown> => {
  throw new Error('View:resolve must not run for a bare --view-url')
})

mock.module('../../kernel', () => ({
  bindGraph: () => ({ get: getMock }),
  expandSelfInPath: async (path: string) => ({ path }),
  resolveKernelTarget: mock(),
  withKernelClient: async (
    _opts: unknown,
    run: (ctx: { client: { call: typeof clientCallMock } }) => Promise<unknown>,
  ) => run({ client: { call: clientCallMock } }),
}))

beforeEach(() => {
  getMock.mockClear()
  clientCallMock.mockClear()
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
