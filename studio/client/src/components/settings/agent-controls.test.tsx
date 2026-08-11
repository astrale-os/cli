import type { HarnessStatus } from '@shared/types'
import type { Dispatch, SetStateAction } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CLAUDE_CAPABILITIES } from '../../../../server/agent/harness/claude/capabilities'
import { AgentSettings } from './agent'

const noopSetter: Dispatch<SetStateAction<Record<string, string>>> = () => {}

const claudeHarness: HarnessStatus = {
  id: 'claude',
  label: 'Claude Code (local)',
  bin: 'claude',
  ok: true,
  version: 'test',
  message: 'Detected',
  options: [{ id: 'claude', label: 'Claude Code (local)' }],
  locked: false,
  source: 'domain',
  capabilities: CLAUDE_CAPABILITIES,
}

test('Claude settings expose model suggestions and native effort modes', () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AgentSettings
        harness={claudeHarness}
        values={{ agentEffort: 'max' }}
        setValues={noopSetter}
        agentModels={{ claude: 'opus' }}
        setAgentModels={noopSetter}
      />
    </QueryClientProvider>,
  )

  expect(html).toMatch(/<input[^>]*aria-label="Agent model"[^>]*value="opus"/)
  for (const [id, label] of [
    ['fable', 'Fable'],
    ['sonnet', 'Sonnet'],
    ['opus', 'Opus'],
  ])
    expect(html).toMatch(new RegExp(`<option value="${id}" label="${label}"`))
  expect(html).toMatch(/<button(?=[^>]*value="max")(?=[^>]*aria-checked="true")[^>]*>Max<\/button>/)
  expect(html).toMatch(/<button[^>]*value="ultracode"[^>]*>Ultracode<\/button>/)
})
