import type { ChatInfo, HarnessLoadout } from '@shared/contracts/agent'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { TooltipProvider } from '@/components/ui/tooltip'
import { qk } from '@/lib/api'

import { ChatFastToggle } from './chat-fast'

const chat = { id: 'chat-fast', harness: 'codex' } as ChatInfo

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

test('the fast toggle exists only where ACP advertises it, and follows the chat override', () => {
  const loadout: HarnessLoadout = {
    ok: true,
    fastMode: { enabled: false, description: '1.5x speed, increased usage' },
    probedAt: 0,
    source: 'acp',
  }
  expect(render({ ...loadout, fastMode: undefined })).toBe('')
  expect(render(loadout)).toContain('aria-label="Enable fast mode"')
  expect(render(loadout, { ...chat, fastMode: true })).toContain('aria-pressed="true"')
})
