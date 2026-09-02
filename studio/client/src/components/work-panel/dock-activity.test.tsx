import type { AgentRun } from '@shared/types'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { brandTone, NEUTRAL_TONE } from './chat-tone'
import { DockActivity } from './dock-activity'

/** A turn that started `ms` ago — half a second off the tick, so the read is stable. */
function running(ms: number, harness = 'claude'): AgentRun {
  return {
    id: 'run-1',
    chatId: 'chat-1',
    harness,
    status: 'running',
    createdAt: new Date(Date.now() - ms).toISOString(),
    summary: 'Rename the Invoice class',
    targetCommentIds: [],
    events: [],
  }
}

test('the bar reports the agent at work and how long it has been', () => {
  const html = renderToStaticMarkup(
    <DockActivity run={running(65_500)} harness="claude" tone={brandTone('claude')} />,
  )

  // the mark turns at the tab strip's pace, in that agent's own colour — and the
  // duration wins only as long as no variant re-issues the `animation` shorthand
  // after it, so both halves of the pair are pinned here
  expect(html).toContain('text-brand-claude')
  expect(html).toContain('animate-spin [animation-duration:4s]')
  expect(html).toContain('1m 05s')
})

test('an agent the studio has no mark for still beats', () => {
  const html = renderToStaticMarkup(
    <DockActivity run={running(3_500, 'gemini')} harness="gemini" tone={NEUTRAL_TONE} />,
  )

  expect(html).not.toContain('<svg')
  expect(html).toContain('rounded-full bg-primary')
  expect(html).toContain('3s')
})
