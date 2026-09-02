import type { HarnessPresence, HarnessStatus } from '@shared/types'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentSettings } from './agent'

const claude: HarnessPresence = {
  id: 'claude',
  label: 'Claude Code',
  bin: 'claude',
  ok: true,
  version: '0.70.0',
  message: 'Claude Agent initialized over ACP v1',
  capabilities: {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  },
}

const codex: HarnessPresence = {
  id: 'codex',
  label: 'Codex',
  bin: 'codex',
  ok: false,
  message: 'codex ACP agent exited 127: command not found',
  capabilities: {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'none',
  },
}

const status: HarnessStatus = {
  ...claude,
  harnesses: [claude, codex],
  locked: false,
  source: 'starred',
}

test('Settings reports every local agent, detected or not', () => {
  const html = renderToStaticMarkup(<AgentSettings harness={status} />)

  expect(html).toContain('Claude Code')
  expect(html).toContain('0.70.0')
  expect(html).toContain('Claude Agent initialized over ACP v1')
  expect(html).toContain('Codex')
  expect(html).toContain('not detected')
  expect(html).toContain('command not found')
})

test('Settings offers no agent, model or effort to choose — those live in the composer', () => {
  const html = renderToStaticMarkup(<AgentSettings harness={status} />)

  expect(html).not.toContain('<select')
  expect(html).not.toContain('<button')
  expect(html).toContain('starred in the composer')
})

test('a process locked by --harness says so instead of pointing at the star', () => {
  const html = renderToStaticMarkup(<AgentSettings harness={{ ...status, locked: true }} />)

  expect(html).toContain('Locked to Claude Code by --harness')
  expect(html).not.toContain('starred in the composer')
})
