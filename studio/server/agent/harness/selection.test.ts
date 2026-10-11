import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { updateStudioSettings } from '../../state/settings'
import { initWorkspaceRoot } from '../../workspace/root'
import { lastKnownPresence, rememberHarnessPresence } from './adapter'
import { getHarnessById } from './registry'
import { getHarness, getHarnessSelection, resolveHarnessConfiguration } from './selection'

const roots: string[] = []
const previous = { harness: process.env.DOMAIN_STUDIO_HARNESS, home: process.env.ASTRALE_HOME }
const REAL = ['claude', 'codex'] as const
// The presence map is process-wide, and other suites probe the agents this machine
// really has: every test here STATES what is installed.
const probed = new Map(REAL.map((id) => [id, lastKnownPresence(id)]))

function installed(...present: string[]): void {
  for (const id of REAL) rememberHarnessPresence(id, present.includes(id))
}

/** A fresh workspace; the machine home (and so the star) is shared by the whole test. */
function workspace(): void {
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-'))
  roots.push(root)
  process.env.ASTRALE_HOME ??= join(roots[0]!, '.astrale')
  initWorkspaceRoot(root)
}

async function configuration(...args: Parameters<typeof resolveHarnessConfiguration>) {
  const result = await resolveHarnessConfiguration(...args)
  if (!result.ok) throw new Error(result.error)
  return { ...result.configuration, harness: result.configuration.harness.id }
}

afterEach(() => {
  for (const [key, value] of [
    ['DOMAIN_STUDIO_HARNESS', previous.harness],
    ['ASTRALE_HOME', previous.home],
  ] as const)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  for (const [id, ok] of probed) rememberHarnessPresence(id, ok)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('the starred model names the agent, for the whole studio, below the environment', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  delete process.env.ASTRALE_HOME
  installed('claude', 'codex')
  workspace()
  expect(getHarnessSelection()).toMatchObject({ id: 'claude', source: 'default' })

  updateStudioSettings({ agentModel: { harness: 'codex', model: 'gpt-5.6-sol' } })
  expect(getHarnessSelection()).toEqual({ id: 'codex', locked: false, source: 'starred' })
  // the star is the STUDIO's, not one domain's or workspace's
  workspace()
  expect(getHarness().id).toBe('codex')

  process.env.DOMAIN_STUDIO_HARNESS = 'claude'
  expect(getHarnessSelection()).toEqual({ id: 'claude', locked: true, source: 'environment' })

  // an unknown starred agent falls back instead of breaking the studio
  delete process.env.DOMAIN_STUDIO_HARNESS
  updateStudioSettings({ agentModel: { harness: 'gemini', model: 'flash' } })
  expect(getHarnessSelection()).toMatchObject({ id: 'claude', source: 'default' })
})

test('the selection follows the agents this machine has, and never rewrites the star', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  delete process.env.ASTRALE_HOME
  workspace()
  installed('codex')
  expect(getHarnessSelection()).toEqual({ id: 'codex', locked: false, source: 'default' })

  updateStudioSettings({ agentModel: { harness: 'claude', model: 'sonnet' } })
  expect(getHarnessSelection()).toEqual({
    id: 'codex',
    locked: false,
    source: 'fallback',
    preferred: 'claude',
  })
  // and it runs CODEX's own default, not the model starred on the missing agent
  expect(await configuration()).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol' })

  // install the agent and the star is honoured again, on the very model it named
  installed('claude', 'codex')
  expect(getHarnessSelection()).toEqual({ id: 'claude', locked: false, source: 'starred' })
  expect(await configuration()).toMatchObject({ harness: 'claude', model: 'sonnet' })

  // with no agent at all there is nothing to fall back TO: the star stays
  installed()
  expect(getHarnessSelection()).toEqual({ id: 'claude', locked: false, source: 'starred' })
})

test('the model is the chat pick, else the star on this agent, else the harness default', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  delete process.env.ASTRALE_HOME
  installed('claude', 'codex')
  workspace()

  const untouched = await configuration()
  expect(untouched.model).toBe('opus[1m]')
  // nothing pinned the reasoning level, so nothing is sent: the agent keeps its own
  expect(untouched.effort).toBeUndefined()

  updateStudioSettings({ agentModel: { harness: 'claude', model: 'sonnet' } })
  expect((await configuration()).model).toBe('sonnet')
  expect(await configuration(undefined, { model: 'haiku', effort: 'max' })).toMatchObject({
    model: 'haiku',
    effort: 'max',
  })
  // a star on the other agent does not lend this one its model
  expect((await configuration(getHarnessById('codex'))).model).toBe('gpt-5.6-sol')
})
