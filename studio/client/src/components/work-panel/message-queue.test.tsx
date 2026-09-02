import type { QueuedMessage } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { firstLine, MessageQueue, type PendingMessage } from './message-queue'

const message = (id: string, text: string): QueuedMessage => ({
  id,
  text,
  createdAt: '2026-09-01T00:00:00.000Z',
})

function render(queued: QueuedMessage[], pending: PendingMessage[] = [], running = true): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MessageQueue chatId="chat-1" queued={queued} pending={pending} running={running} />
    </QueryClientProvider>,
  )
}

test('an empty queue takes no room at all', () => {
  expect(render([])).toBe('')
})

test('each waiting message shows its first line and the controls that reorder it', () => {
  const html = render([
    message('a', 'Rename the Invoice class\nand update every caller'),
    message('b', 'Then add a test'),
  ])

  // the first line is the row; the whole message is one hover away, in the title
  expect(html).toContain('>Rename the Invoice class<')
  expect(html).not.toContain('>Rename the Invoice class\nand update every caller<')
  expect(html).toContain('and update every caller')
  expect(html).toContain('2 queued')

  for (const action of ['Move', 'Edit', 'Send', 'Delete'])
    expect(html).toContain(`aria-label="${action}`)
})

test('the ends of the queue cannot move past themselves', () => {
  const html = render([message('a', 'first'), message('b', 'second')])

  // "earlier" is dead on the first row and "later" on the last — and only those
  // two, so the control cluster never changes width under the pointer
  expect(html.match(/disabled=""/g)).toHaveLength(2)
  expect(html).toContain('aria-label="Move &quot;first&quot; earlier"')
  expect(html).toContain('aria-label="Move &quot;second&quot; later"')
})

test('a message still on the wire shows as sending, with nothing to reorder', () => {
  const html = render([], [{ id: 'pending-1', label: 'just typed' }])

  expect(html).toContain('just typed')
  expect(html).toContain('aria-label="Sending"')
  expect(html).not.toContain('aria-label="Delete')
  expect(html).toContain('1 queued')
})

test('the header says why a queue is not moving', () => {
  expect(render([message('a', 'waiting')], [], true)).toContain('sent when this turn ends')
  expect(render([message('a', 'waiting')], [], false)).toContain('the agent is stopped')
})

test('a first line is what fits on a row, whatever the message is made of', () => {
  expect(firstLine('  one\ntwo  ')).toBe('one')
  expect(firstLine('\n\n')).toBe('')
})
