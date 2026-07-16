import { expect, test } from 'bun:test'

import { forwardBridgeTool } from './client'

test('marks HTTP and transport failures as MCP tool errors', async () => {
  const denied = await forwardBridgeTool(
    'http://studio.test',
    'token',
    'reply',
    {},
    async () => new Response('denied', { status: 401 }),
  )
  expect(denied).toEqual({
    content: [{ type: 'text', text: 'bridge error 401: denied' }],
    isError: true,
  })

  const unavailable = await forwardBridgeTool(
    'http://studio.test',
    'token',
    'reply',
    {},
    async () => {
      throw new Error('offline')
    },
  )
  expect(unavailable).toEqual({
    content: [{ type: 'text', text: 'bridge call failed: offline' }],
    isError: true,
  })
})

test('keeps the scoped bearer authoritative and returns successful content', async () => {
  let sent: any
  const response = await forwardBridgeTool(
    'http://studio.test',
    'scoped',
    'threads',
    { token: 'forged' },
    async (_url, init) => {
      sent = JSON.parse(String(init?.body))
      return new Response('{"threads":[]}')
    },
  )
  expect(sent).toEqual({ token: 'scoped' })
  expect(response).toEqual({
    content: [{ type: 'text', text: '{"threads":[]}' }],
  })
})
