import type { HarnessPresence, HarnessStatus } from '@shared/types'

import { expect, test } from 'bun:test'

import { noAgentNotice } from './harnesses'

function presence(id: string, label: string, ok: boolean): HarnessPresence {
  const capabilities = {
    effortLevels: [],
    accessLevels: [],
    ask: true,
    loadout: true,
    gateway: 'none',
  } as const
  return { id, label, bin: id, ok, message: '', capabilities }
}

const status = (...harnesses: HarnessPresence[]): HarnessStatus => ({
  ...harnesses[0]!,
  harnesses,
  locked: false,
  source: 'default',
})

test('"no agent" is said only when every probed agent is missing, naming them all', () => {
  const claude = presence('claude', 'Claude Code', false)
  expect(noAgentNotice(undefined)).toBeUndefined()
  expect(noAgentNotice(status(claude, presence('codex', 'Codex', true)))).toBeUndefined()
  expect(noAgentNotice(status(claude, presence('codex', 'Codex', false)))?.line).toBe(
    'No coding agent found — install Claude Code or Codex',
  )
})
