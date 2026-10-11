import type { ChatInfo, HarnessLoadout, HarnessStatus } from '@shared/contracts/agent'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { ChatEffortPicker, meterGeometry } from './chat-effort'

const chat = { id: 'chat-1', harness: 'codex' } as ChatInfo
const harness = {
  harnesses: [{ id: 'codex', capabilities: { effortLevels: ['low', 'medium', 'high'] } }],
} as unknown as HarnessStatus

const probed: HarnessLoadout = {
  ok: true,
  effort: 'high',
  nativeEffort: 'high',
  efforts: (['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const).map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
  })),
  probedAt: 0,
  source: 'acp',
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

test('the meter reads the running level, one bar per rung the agent reported', () => {
  const html = render(probed)
  expect(html).toContain('Reasoning: High')
  expect(html.match(/<rect/g)?.length).toBe(6)
  // nothing to show before anything names a level, or for a model that does not reason
  expect(render(undefined)).toBe('')
  expect(render({ ...probed, efforts: [], effort: undefined })).toBe('')
})

test('a pinned level outranks the agent’s own, landing on its nearest offered rung', () => {
  expect(render(probed, { ...chat, effort: 'max' })).toContain('Reasoning: Max')
  const noUltra = { ...probed, efforts: probed.efforts!.filter((o) => o.id !== 'ultra') }
  expect(render(noUltra, { ...chat, effort: 'ultra' })).toContain('Reasoning: Max')
  // before the probe lands, on the agent's declared ladder
  const html = render(undefined, { ...chat, effort: 'high' })
  expect(html).toContain('Reasoning: High')
  expect(html.match(/<rect/g)?.length).toBe(3)
})

test('every bar is the same whole number of device pixels, at any display scale', () => {
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 3]) {
    for (const total of [2, 3, 6, 8]) {
      const meter = meterGeometry(total, dpr)
      expect(new Set(meter.bars.map((bar) => bar.width)).size).toBe(1)
      const step = (key: 'x' | 'height') =>
        new Set(meter.bars.slice(1).map((bar, i) => bar[key] - meter.bars[i]![key]))
      expect(step('x').size).toBeLessThanOrEqual(1)
      expect(step('height').size).toBe(1)
      for (const bar of meter.bars) {
        for (const value of [bar.x, bar.y, bar.width, bar.height])
          expect(Number.isInteger(value)).toBe(true)
        expect(bar.y + bar.height).toBe(meter.viewHeight)
      }
      expect(meter.width * dpr).toBeCloseTo(meter.viewWidth, 9)
      expect(meter.height * dpr).toBeCloseTo(meter.viewHeight, 9)
    }
  }
})
