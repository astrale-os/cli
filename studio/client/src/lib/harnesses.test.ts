import type { HarnessPresence, HarnessStatus } from '@shared/types'

import { expect, test } from 'bun:test'

import { noAgentNotice } from './harnesses'

const capabilities = {
  effortLevels: [],
  accessLevels: [],
  ask: true,
  loadout: true,
  gateway: 'anthropic',
} as const

function presence(id: string, label: string, ok: boolean): HarnessPresence {
  return { id, label, bin: id, ok, message: ok ? 'Detected' : 'not detected', capabilities }
}

function status(...harnesses: HarnessPresence[]): HarnessStatus {
  return { ...harnesses[0]!, harnesses, locked: false, source: 'default' }
}

test('one agent down is not "no agent" — that stays the harness\'s own business', () => {
  const claude = presence('claude', 'Claude Code', false)
  const codex = presence('codex', 'Codex', true)
  expect(noAgentNotice(status(claude, codex))).toBeUndefined()
  expect(noAgentNotice(status(codex, claude))).toBeUndefined()
})

test('no agent at all is said outright, and names every one that could be installed', () => {
  const notice = noAgentNotice(
    status(presence('claude', 'Claude Code', false), presence('codex', 'Codex', false)),
  )
  expect(notice?.full).toContain('No coding agent found on this machine')
  expect(notice?.full).toContain('Claude Code or Codex')
  // and the one-line form the dock's resting bar shows says the same thing
  expect(notice?.line).toBe('No coding agent found — install Claude Code or Codex')
})

test('a studio still probing says nothing — "no agent" must not flash at someone who has one', () => {
  expect(noAgentNotice(undefined)).toBeUndefined()
  expect(
    noAgentNotice({
      ...presence('claude', 'Claude Code', false),
      harnesses: [],
      locked: false,
      source: 'default',
    }),
  ).toBeUndefined()
})
