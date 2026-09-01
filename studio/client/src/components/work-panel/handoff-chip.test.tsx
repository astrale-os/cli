import type { ChatOrigin } from '@shared/types'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { HandoffChip } from './handoff-chip'

const origin = (pendingHandoff: boolean): ChatOrigin => ({
  chatId: 'source-chat',
  harness: 'claude',
  pendingHandoff,
  summary: 'Transferred context',
})

function render(pendingHandoff: boolean): string {
  return renderToStaticMarkup(
    <HandoffChip
      origin={origin(pendingHandoff)}
      harnessLabel="Claude Code"
      tone={{ mark: 'text-chat-1', surface: 'bg-chat-1/12' }}
      onOpenSource={() => {}}
      onForget={() => {}}
    />,
  )
}

test('handoff provenance opens the source chat without exposing a pending badge', () => {
  const html = render(true)

  expect(html).toContain('aria-label="Open Claude Code source chat"')
  expect(html).toContain('aria-label="Show transferred context"')
  expect(html).toContain('Continued from')
  expect(html).not.toMatch(/>pending</)
})

test('only unsent context offers a delete action', () => {
  expect(render(true)).toContain('aria-label="Delete transferred context before sending"')
  expect(render(false)).not.toContain('aria-label="Delete transferred context before sending"')
})
