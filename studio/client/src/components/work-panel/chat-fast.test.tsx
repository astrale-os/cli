import type { ChatInfo, HarnessLoadout } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TooltipProvider } from '@/components/ui/misc'
import { qk } from '@/lib/api'

import { ChatFastToggle } from './chat-fast'

const chat: ChatInfo = {
  id: 'chat-fast',
  title: 'Work',
  harness: 'codex',
  turns: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'idle',
  queued: [],
}

function render(loadout: HarnessLoadout, current = chat): string {
  const client = new QueryClient()
  client.setQueryData(qk.loadout(current.id), loadout)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ChatFastToggle chat={current} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const loadout: HarnessLoadout = {
  ok: true,
  fastMode: { enabled: false, description: '1.5x speed, increased usage' },
  probedAt: 0,
  source: 'acp',
}

test('the flash appears only when ACP advertises fast mode', () => {
  expect(render(loadout)).toContain('aria-label="Enable fast mode"')
  expect(render({ ...loadout, fastMode: undefined })).toBe('')
})

test('the chat override controls the flash independently of the probed default', () => {
  const html = render(loadout, { ...chat, fastMode: true })
  expect(html).toContain('aria-label="Disable fast mode"')
  expect(html).toContain('aria-pressed="true"')
})
