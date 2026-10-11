import type {
  ChatInfo,
  HarnessLoadout,
  HarnessModelCatalog,
  HarnessPresence,
  HarnessStatus,
} from '@shared/contracts/agent'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { ChatModelPicker, starPlacement } from './chat-model'

const chat = { id: 'chat-1', harness: 'claude' } as ChatInfo
const CLAUDE = { id: 'claude', label: 'Claude Code', ok: true } as HarnessPresence
const CODEX = { id: 'codex', label: 'Codex', ok: true } as HarnessPresence

/** The status the server sends for the agent it decided to open on. */
const status = (running: HarnessPresence, extra: Partial<HarnessStatus> = {}) =>
  ({
    ...running,
    harnesses: [CLAUDE, CODEX],
    locked: false,
    source: 'default',
    ...extra,
  }) as HarnessStatus

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
  seed: { catalog?: HarnessModelCatalog[]; loadout?: HarnessLoadout },
  current = chat,
) {
  const client = new QueryClient()
  if (seed.catalog) client.setQueryData(qk.models, seed.catalog)
  if (seed.loadout) client.setQueryData(qk.loadout(current.id), seed.loadout)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ChatModelPicker chat={current} harness={status(CLAUDE)} />
    </QueryClientProvider>,
  )
}

test('the picker names the model the chat will actually run, never a placeholder', () => {
  expect(render({ catalog })).toContain('Opus 5 (1M context)')
  expect(render({ catalog }, { ...chat, model: 'fable' })).toContain('Fable 5')
  // a model the catalog does not list falls back to its own slug
  expect(render({ catalog }, { ...chat, model: 'sonnet-next' })).toContain('sonnet-next')
  // with no catalog entry, the per-chat probe still names it
  const loadout: HarnessLoadout = {
    ok: true,
    model: 'gpt-5.6-luna',
    models: [{ id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' }],
    probedAt: 0,
    source: 'acp',
  }
  expect(render({ loadout })).toContain('GPT-5.6-Luna')
  // before any probe, or for an agent this machine lacks, nothing rather than "default"
  expect(render({})).toBe('')
  const missing = { harness: 'claude', label: 'Claude Code', available: false, models: [] }
  expect(render({ catalog: [missing] })).toBe('')
})

test('the star says where a new chat opens, and never sits on an agent that is missing', () => {
  expect(starPlacement(status(CLAUDE), null, 'opus[1m]')).toEqual({
    shown: { harness: 'claude', model: 'opus[1m]' },
    remembered: null,
  })
  const starred = { harness: 'codex', model: 'gpt-5.6-sol' }
  expect(starPlacement(status(CODEX, { source: 'starred' }), starred, 'gpt-5.6-sol').shown).toEqual(
    starred,
  )
  // a star on a missing agent moves to the one that runs, and is kept, not dropped
  const stranded = { harness: 'claude', model: 'sonnet' }
  expect(
    starPlacement(
      status(CODEX, { source: 'fallback', preferred: 'claude' }),
      stranded,
      'gpt-5.6-sol',
    ),
  ).toEqual({ shown: { harness: 'codex', model: 'gpt-5.6-sol' }, remembered: stranded })
  expect(starPlacement(undefined, null, 'opus[1m]').shown).toBeNull()
})
