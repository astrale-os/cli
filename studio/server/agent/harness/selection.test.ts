import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { updateSettings } from '../../state/settings'
import { settingsRoot } from '../../studio-settings'
import { initWorkspaceState } from '../../workspace-state'
import { lastKnownPresence, rememberHarnessPresence } from './adapter'
import { getHarnessById } from './registry'
import { getHarness, getHarnessSelection, resolveHarnessConfiguration } from './selection'

const roots: string[] = []
const previous = process.env.DOMAIN_STUDIO_HARNESS
const previousHome = process.env.ASTRALE_HOME
let machineHome: string | undefined
const REAL = ['claude', 'codex'] as const
// The presence map is process-wide, and other suites in this run probe the agents
// this machine really has. Every test here therefore STATES what is installed —
// otherwise the answers would depend on the laptop the suite runs on.
const probed = new Map(REAL.map((id) => [id, lastKnownPresence(id)]))

/** Declare which agents this machine has, for the length of one test. */
function installed(...present: string[]): void {
  for (const id of REAL) rememberHarnessPresence(id, present.includes(id))
}

/** A workspace with nothing starred yet. */
function workspace(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `studio-harness-${name}-`))
  roots.push(root)
  machineHome ??= join(root, '.astrale')
  process.env.ASTRALE_HOME = machineHome
  initWorkspaceState(root)
  return root
}

afterEach(() => {
  if (previous === undefined) delete process.env.DOMAIN_STUDIO_HARNESS
  else process.env.DOMAIN_STUDIO_HARNESS = previous
  if (previousHome === undefined) delete process.env.ASTRALE_HOME
  else process.env.ASTRALE_HOME = previousHome
  machineHome = undefined
  for (const [id, ok] of probed) rememberHarnessPresence(id, ok)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('the starred model names the agent the studio opens on', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  installed('claude', 'codex')
  workspace('a')
  expect(getHarnessSelection()).toMatchObject({ id: 'claude', source: 'default' })

  updateSettings(settingsRoot(), { agentModel: { harness: 'codex', model: 'gpt-5.6-sol' } })
  expect(getHarnessSelection()).toEqual({ id: 'codex', locked: false, source: 'starred' })
  expect(getHarness().id).toBe('codex')

  // The star is the STUDIO's, not one domain's or workspace's.
  workspace('b')
  expect(getHarnessSelection()).toEqual({ id: 'codex', locked: false, source: 'starred' })
  expect(getHarness().id).toBe('codex')
})

test('an unknown starred agent falls back instead of breaking the domain', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  installed('claude', 'codex')
  workspace('unknown')
  updateSettings(settingsRoot(), { agentModel: { harness: 'gemini', model: 'flash' } })
  expect(getHarnessSelection()).toMatchObject({ id: 'claude', source: 'default' })
})

test('the environment outranks the starred model, and says so', () => {
  installed('claude', 'codex')
  workspace('env')
  updateSettings(settingsRoot(), { agentModel: { harness: 'claude', model: 'opus[1m]' } })
  process.env.DOMAIN_STUDIO_HARNESS = 'codex'
  expect(getHarnessSelection()).toEqual({ id: 'codex', locked: true, source: 'environment' })
})

test('with nothing starred, the studio opens on the agent this machine has', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  workspace('installed')

  installed('codex')
  expect(getHarnessSelection()).toEqual({ id: 'codex', locked: false, source: 'default' })

  installed('claude', 'codex')
  expect(getHarnessSelection()).toEqual({ id: 'claude', locked: false, source: 'default' })
})

test('a star on an agent this machine lacks opens on the one it has — and keeps the star', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  workspace('stranded')
  updateSettings(settingsRoot(), { agentModel: { harness: 'claude', model: 'sonnet' } })

  installed('codex')
  expect(getHarnessSelection()).toEqual({
    id: 'codex',
    locked: false,
    source: 'fallback',
    preferred: 'claude',
  })
  // and it runs CODEX's own default, not the model starred on the missing agent
  const fallback = await resolveHarnessConfiguration()
  expect(fallback.ok).toBe(true)
  if (!fallback.ok) return
  expect(fallback.configuration.harness.id).toBe('codex')
  expect(fallback.configuration.model).toBe('gpt-5.6-sol')

  // Nothing was written: install the agent and the star is honoured again, on the
  // very model it always named.
  installed('claude', 'codex')
  expect(getHarnessSelection()).toEqual({ id: 'claude', locked: false, source: 'starred' })
  const restored = await resolveHarnessConfiguration()
  expect(restored.ok).toBe(true)
  if (!restored.ok) return
  expect(restored.configuration.harness.id).toBe('claude')
  expect(restored.configuration.model).toBe('sonnet')
})

test('with no agent at all, the selection stays on the star rather than inventing one', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  workspace('none')
  updateSettings(settingsRoot(), { agentModel: { harness: 'claude', model: 'sonnet' } })

  installed()
  // no substitute exists, so there is nothing to fall back TO — the status route
  // reports every harness as absent, and that is what the GUI says out loud
  expect(getHarnessSelection()).toEqual({ id: 'claude', locked: false, source: 'starred' })

  updateSettings(settingsRoot(), { agentModel: null })
  expect(getHarnessSelection()).toEqual({ id: 'claude', locked: false, source: 'default' })
})

test('an unpinned chat runs the harness default model, not whatever the agent ships with', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  installed('claude', 'codex')
  workspace('model')

  const untouched = await resolveHarnessConfiguration()
  expect(untouched.ok).toBe(true)
  if (!untouched.ok) return
  expect(untouched.configuration.model).toBe('opus[1m]')
  // nothing pinned the reasoning level, so nothing is sent: the agent keeps its own
  expect(untouched.configuration.effort).toBeUndefined()

  // the starred model outranks it, and the chat's own pick outranks both
  updateSettings(settingsRoot(), { agentModel: { harness: 'claude', model: 'sonnet' } })
  const starred = await resolveHarnessConfiguration()
  expect(starred.ok).toBe(true)
  if (!starred.ok) return
  expect(starred.configuration.model).toBe('sonnet')

  const perChat = await resolveHarnessConfiguration(undefined, {
    model: 'haiku',
    effort: 'max',
  })
  expect(perChat.ok).toBe(true)
  if (!perChat.ok) return
  expect(perChat.configuration.model).toBe('haiku')
  expect(perChat.configuration.effort).toBe('max')
})

test('a star on the other agent does not lend this one its model', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  installed('claude', 'codex')
  workspace('cross')
  updateSettings(settingsRoot(), { agentModel: { harness: 'claude', model: 'sonnet' } })

  const codex = await resolveHarnessConfiguration(getHarnessById('codex'))
  expect(codex.ok).toBe(true)
  if (!codex.ok) return
  expect(codex.configuration.model).toBe('gpt-5.6-sol')
})
