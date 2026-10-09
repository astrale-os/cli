import type { ChatInfo, HarnessLoadout, HarnessStatus } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { ChatEffortPicker, meterGeometry } from './chat-effort'

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
  expect(html.match(/<rect/g)?.length).toBe(6)
})

test('the meter rises in even, whole-pixel steps, whatever the ladder’s length', () => {
  for (const length of [2, 3, 4, 5, 6]) {
    const ladder: HarnessLoadout = {
      ...probed,
      effort: 'low',
      efforts: probed.efforts!.slice(0, length),
    }
    const html = render(ladder)
    const heights = [...html.matchAll(/<rect[^>]*height="([\d.]+)"/g)].map((match) =>
      Number(match[1]),
    )
    expect(heights).toHaveLength(length)
    expect(heights[0]).toBe(4)
    const steps = heights.slice(1).map((height, index) => height - heights[index]!)
    expect(new Set(steps)).toEqual(new Set([2]))
    // the tallest ladder still fits the composer's 20px row
    expect(Math.max(...heights)).toBeLessThanOrEqual(20)
  }
})

test('every bar is the same whole number of device pixels, at any display scale', () => {
  // At 125% a 2px bar is 2.5 device pixels: laid out in CSS px, the browser rounded
  // each bar on its own and the meter came out 2·3·3·2·2·3 wide. The geometry is on
  // the device grid now, so widths, gaps and rises are whole and identical.
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 3]) {
    for (const total of [2, 3, 6, 8]) {
      const meter = meterGeometry(total, dpr)
      expect(meter.bars).toHaveLength(total)
      const widths = new Set(meter.bars.map((bar) => bar.width))
      expect(widths.size).toBe(1)
      const pitches = new Set(meter.bars.slice(1).map((bar, index) => bar.x - meter.bars[index]!.x))
      expect(pitches.size).toBeLessThanOrEqual(1)
      const rises = new Set(
        meter.bars.slice(1).map((bar, index) => bar.height - meter.bars[index]!.height),
      )
      expect(rises.size).toBe(1)
      for (const bar of meter.bars) {
        for (const value of [bar.x, bar.y, bar.width, bar.height]) {
          expect(Number.isInteger(value)).toBe(true)
        }
        // bottoms line up on the SVG's baseline
        expect(bar.y + bar.height).toBe(meter.viewHeight)
      }
      // the SVG's CSS box maps its viewBox exactly onto device pixels
      expect(meter.width * dpr).toBeCloseTo(meter.viewWidth, 9)
      expect(meter.height * dpr).toBeCloseTo(meter.viewHeight, 9)
      // and the meter keeps its size, give or take the rounding
      expect(Math.abs(meter.width - (total * 3 - 1))).toBeLessThan(total)
    }
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
  expect(html.match(/<rect/g)?.length).toBe(3)
})
