import { expect, test } from 'bun:test'

import { forwardBridgeTool } from './client'

type Fetcher = NonNullable<Parameters<typeof forwardBridgeTool>[4]>
const forward = (fetcher: Fetcher, args: Record<string, unknown> = {}) =>
  forwardBridgeTool('http://studio.test', 'scoped', 'threads', args, fetcher)
const content = (text: string): [{ type: 'text'; text: string }] => [{ type: 'text', text }]

test('the scoped bearer is authoritative, and any failure is an MCP tool error', async () => {
  let sent: unknown
  const ok = await forward(
    async (_url, init) => {
      sent = JSON.parse(String(init?.body))
      return new Response('{"threads":[]}')
    },
    { token: 'forged' },
  )
  expect(ok).toEqual({ content: content('{"threads":[]}') })
  expect(sent).toEqual({ token: 'scoped' })

  expect(await forward(async () => new Response('denied', { status: 401 }))).toEqual({
    content: content('bridge error 401: denied'),
    isError: true,
  })
  const offline = async (): Promise<Response> => {
    throw new Error('offline')
  }
  expect(await forward(offline)).toEqual({
    content: content('bridge call failed: offline'),
    isError: true,
  })
})
