import type { ChatInfo, HarnessLoadout, HarnessModelCatalog, HarnessStatus } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { ChatModelPicker } from './chat-model'

const DOMAIN = 'shop'

const chat: ChatInfo = {
  id: 'chat-1',
  title: 'New chat',
  harness: 'claude',
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
  source: 'domain',
  capabilities: {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  },
  harnesses: [],
}

const catalog: HarnessModelCatalog[] = [
  {
    harness: 'claude',
    label: 'Claude Code',
    available: true,
    defaultModel: 'opus[1m]',
    models: [
      { id: 'opus[1m]', label: 'Opus 5 (1M context)' },
      { id: 'fable', label: 'Fable 5' },
    ],
  },
]

function render(
  seed: { catalog?: HarnessModelCatalog[]; loadout?: HarnessLoadout } = {},
  current = chat,
): string {
  const client = new QueryClient()
  if (seed.catalog) client.setQueryData(qk.models(DOMAIN), seed.catalog)
  if (seed.loadout) client.setQueryData(qk.loadout(DOMAIN, current.id), seed.loadout)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ChatModelPicker domainId={DOMAIN} chat={current} harness={harness} />
    </QueryClientProvider>,
  )
}

test('a chat that pins nothing is named by the model it will actually run', () => {
  // the catalog alone is enough — it is what the panel warms before you open it
  expect(render({ catalog })).toContain('Opus 5 (1M context)')
})

test('a pinned model outranks the harness default', () => {
  expect(render({ catalog }, { ...chat, model: 'fable' })).toContain('Fable 5')
})

test('before any probe answers, the label is absent rather than “default”', () => {
  const html = render()
  expect(html).toBe('')
  expect(html).not.toContain('default')
})

test('an agent this machine does not have shows no model at all', () => {
  const missing: HarnessModelCatalog[] = [
    {
      harness: 'claude',
      label: 'Claude Code',
      available: false,
      detail: 'Claude Code is not detected on this machine',
      models: [],
    },
  ]
  expect(render({ catalog: missing })).toBe('')
})

test('with no catalog entry the per-chat probe still names the model', () => {
  const loadout: HarnessLoadout = {
    ok: true,
    model: 'gpt-5.6-luna',
    models: [{ id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' }],
    probedAt: 0,
    source: 'acp',
  }
  expect(render({ loadout })).toContain('GPT-5.6-Luna')
})

test('a model the catalog does not list falls back to its own slug, never to “default”', () => {
  const html = render({ catalog }, { ...chat, model: 'sonnet-next' })
  expect(html).toContain('sonnet-next')
  expect(html).not.toContain('default model')
})
