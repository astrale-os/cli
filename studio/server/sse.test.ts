import { expect, test } from 'bun:test'

import { broadcast, sseResponse } from './sse'

test('SSE response preserves headers and emits the initial workspace frame', async () => {
  const response = sseResponse(['issues', 'shell'])
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/event-stream')
  expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
  expect(response.headers.get('connection')).toBe('keep-alive')

  const reader = response.body!.getReader()
  const first = await reader.read()
  expect(new TextDecoder().decode(first.value)).toBe(
    'data: {"type":"hello","domains":["issues","shell"]}\n\n',
  )

  expect(broadcast({ type: 'workspace', domains: ['issues', 'billing'] })).toBe(1)
  const update = await reader.read()
  expect(new TextDecoder().decode(update.value)).toBe(
    'data: {"type":"workspace","domains":["issues","billing"]}\n\n',
  )

  await reader.cancel()
  expect(broadcast({ type: 'workspace', domains: [] })).toBe(0)
})
