import type { ChatInfo, HarnessLoadout, HarnessStatus } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { ChatEffortPicker } from './chat-effort'

const chat: ChatInfo = {
  id: 'chat-1',
  title: 'New chat',
  harness: 'codex',
  turns: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'idle',
  queued: [],
}

const harness: HarnessStatus = {
  id: 'claude',
  label: 'Claude Code',
  bin: 'claude',
  ok: true,
  message: 'Detected',
  locked: false,
  source: 'starred',
  capabilities: {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  },
  harnesses: [
    {
      id: 'codex',
      label: 'Codex',
      bin: 'codex',
      ok: true,
      message: 'Detected',
      capabilities: {
        effortLevels: ['low', 'medium', 'high'],
        accessLevels: ['workspace', 'full'],
        ask: true,
        loadout: true,
        gateway: 'none',
      },
    },
  ],
}

function render(loadout: HarnessLoadout | undefined, current = chat): string {
  const client = new QueryClient()
  if (loadout) client.setQueryData(qk.loadout(current.id), loadout)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ChatEffortPicker chat={current} harness={harness} />
    </QueryClientProvider>,
  )
}

const probed: HarnessLoadout = {
  ok: true,
  effort: 'high',
  nativeEffort: 'high',
  efforts: [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'Xhigh' },
    { id: 'max', label: 'Max' },
    { id: 'ultra', label: 'Ultra' },
  ],
  probedAt: 0,
  source: 'acp',
}

test('the meter reads the level the ACP session is actually on', () => {
  const html = render(probed)
  expect(html).toContain('Reasoning: High')
  // one bar per rung the agent reported, filled up to the running one
  expect(html.match(/w-\[2px\]/g)?.length).toBe(6)
})

test('the meter rises in even, whole-pixel steps, whatever the ladder’s length', () => {
  // A ramp squeezed into a fixed range left every inner rung on a fractional height
  // (six came out 5·6.4·7.8·9.2·10.6·12): each top landed between two pixels and
  // painted soft, and the rises read as 1px or 2px — a smeared meter, not a rising one.
  for (const length of [2, 3, 4, 5, 6]) {
    const ladder: HarnessLoadout = {
      ...probed,
      effort: 'low',
      efforts: probed.efforts!.slice(0, length),
    }
    const html = render(ladder)
    const heights = [...html.matchAll(/height:\s*([\d.]+)px/g)].map((match) => Number(match[1]))
    expect(heights).toHaveLength(length)
    expect(heights.every(Number.isInteger)).toBe(true)
    expect(heights[0]).toBe(4)
    const steps = heights.slice(1).map((height, index) => height - heights[index]!)
    expect(new Set(steps)).toEqual(new Set([2]))
    // the tallest ladder still fits the composer's 20px row
    expect(Math.max(...heights)).toBeLessThanOrEqual(20)
    // a half-pixel gap started every other bar mid-pixel; the gap is a whole one now
    expect(html).toContain('gap-px')
    expect(html).not.toContain('gap-[1.5px]')
  }
})

test('a level pinned on the chat outranks the agent’s own', () => {
  expect(render(probed, { ...chat, effort: 'max' })).toContain('Reasoning: Max')
})

test('a level this model does not offer lands on its nearest rung', () => {
  // Claude has no `ultra`; a chat forked from Codex carrying it reads as Max
  const claudeLadder: HarnessLoadout = {
    ...probed,
    effort: 'medium',
    efforts: probed.efforts!.filter((option) => option.id !== 'ultra'),
  }
  expect(render(claudeLadder, { ...chat, effort: 'ultra' })).toContain('Reasoning: Max')
})

test('a model that does no reasoning shows no meter at all', () => {
  expect(render({ ...probed, efforts: [], effort: undefined })).toBe('')
})

test('before anything names a level, the meter waits instead of showing an empty one', () => {
  expect(render(undefined)).toBe('')
})

test('a pinned level renders on the agent’s declared ladder, before its probe lands', () => {
  const html = render(undefined, { ...chat, effort: 'high' })
  expect(html).toContain('Reasoning: High')
  expect(html.match(/w-\[2px\]/g)?.length).toBe(3)
})
