import type { QueuedMessage } from '@shared/contracts/agent'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MessageQueue, type PendingMessage } from './message-queue'

const message = (id: string, text: string): QueuedMessage => ({
  id,
  text,
  createdAt: '2026-09-01T00:00:00.000Z',
})

function render(queued: QueuedMessage[], pending: PendingMessage[] = []): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MessageQueue chatId="chat-1" queued={queued} pending={pending} running />
    </QueryClientProvider>,
  )
}

test('a queued row shows its first line, and the ends of the queue cannot move past themselves', () => {
  const html = render([message('a', 'first\nand more'), message('b', 'second')])
  expect(html).toContain('>first<')
  expect(html.match(/disabled=""/g)).toHaveLength(2)
  expect(html).toContain('aria-label="Move &quot;first&quot; earlier"')
  expect(html).toContain('aria-label="Move &quot;second&quot; later"')
})

test('a message still on the wire shows as sending, with nothing to reorder', () => {
  const html = render([], [{ id: 'pending-1', label: 'just typed' }])
  expect(html).toContain('aria-label="Sending"')
  expect(html).not.toContain('aria-label="Delete')
})
