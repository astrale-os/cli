import type { HarnessStatus } from '@shared/types'
import type { Dispatch, SetStateAction } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentSettings } from './agent'
import { AgentModel } from './agent-model'

const noopSetter: Dispatch<SetStateAction<Record<string, string>>> = () => {}

const claudeHarness: HarnessStatus = {
  id: 'claude',
  label: 'Claude Code',
  bin: 'claude',
  ok: true,
  version: 'test',
  message: 'Detected',
  options: [{ id: 'claude', label: 'Claude Code' }],
  locked: false,
  source: 'domain',
  capabilities: {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  },
}

test('ACP diagnostics populate the model selector', () => {
  const html = renderToStaticMarkup(
    <AgentModel
      selected="opus"
      loadout={{
        ok: true,
        nativeModel: 'sonnet',
        model: 'opus',
        models: [
          { id: 'fable', label: 'Fable' },
          { id: 'sonnet', label: 'Sonnet' },
          { id: 'opus', label: 'Opus' },
        ],
        probedAt: Date.now(),
        source: 'acp',
      }}
      onChange={() => {}}
    />,
  )

  expect(html).toMatch(/<select[^>]*aria-label="Agent model"/)
  for (const [id, label] of [
    ['fable', 'Fable'],
    ['sonnet', 'Sonnet'],
  ])
    expect(html).toMatch(new RegExp(`<option value="${id}">${label}`))
  expect(html).toMatch(/<option value="opus" selected="">Opus/)
})

test('Claude settings expose native effort modes', () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AgentSettings
        harness={claudeHarness}
        values={{ agentEffort: 'max' }}
        setValues={noopSetter}
        agentModels={{}}
        setAgentModels={noopSetter}
      />
    </QueryClientProvider>,
  )

  expect(html).toMatch(/<select[^>]*aria-label="Agent effort"/)
  expect(html).toMatch(/<option value="max" selected="">Max<\/option>/)
  expect(html).toMatch(/<option value="ultracode">Ultracode<\/option>/)
})
