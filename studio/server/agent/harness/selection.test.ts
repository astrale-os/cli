import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { updateSettings } from '../../state/settings'
import { getHarnessById } from './registry'
import { getHarness, getHarnessSelection, resolveHarnessConfiguration } from './selection'

const roots: string[] = []
const previous = process.env.DOMAIN_STUDIO_HARNESS

afterEach(() => {
  if (previous === undefined) delete process.env.DOMAIN_STUDIO_HARNESS
  else process.env.DOMAIN_STUDIO_HARNESS = previous
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('the starred model names the agent a domain opens on', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  const rootA = mkdtempSync(join(tmpdir(), 'studio-harness-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'studio-harness-b-'))
  roots.push(rootA, rootB)
  expect(getHarnessSelection(rootA)).toMatchObject({ id: 'claude', source: 'default' })

  updateSettings(rootA, { agentModel: { harness: 'codex', model: 'gpt-5.6-sol' } })
  expect(getHarnessSelection(rootA)).toEqual({ id: 'codex', locked: false, source: 'domain' })
  expect(getHarness(rootA).id).toBe('codex')

  // one domain's star says nothing about another's
  expect(getHarnessSelection(rootB)).toEqual({ id: 'claude', locked: false, source: 'default' })
  expect(getHarness(rootB).id).toBe('claude')
})

test('an unknown starred agent falls back instead of breaking the domain', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-unknown-'))
  roots.push(root)
  updateSettings(root, { agentModel: { harness: 'gemini', model: 'flash' } })
  expect(getHarnessSelection(root)).toMatchObject({ id: 'claude', source: 'default' })
})

test('the environment outranks the starred model, and says so', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-'))
  roots.push(root)
  updateSettings(root, { agentModel: { harness: 'claude', model: 'opus[1m]' } })
  process.env.DOMAIN_STUDIO_HARNESS = 'codex'
  expect(getHarnessSelection(root)).toEqual({ id: 'codex', locked: true, source: 'environment' })
})

test('an unpinned chat runs the harness default model, not whatever the agent ships with', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-model-'))
  roots.push(root)

  const untouched = await resolveHarnessConfiguration(root)
  expect(untouched.ok).toBe(true)
  if (!untouched.ok) return
  expect(untouched.configuration.model).toBe('opus[1m]')
  // nothing pinned the reasoning level, so nothing is sent: the agent keeps its own
  expect(untouched.configuration.effort).toBeUndefined()

  // the starred model outranks it, and the chat's own pick outranks both
  updateSettings(root, { agentModel: { harness: 'claude', model: 'sonnet' } })
  const starred = await resolveHarnessConfiguration(root)
  expect(starred.ok).toBe(true)
  if (!starred.ok) return
  expect(starred.configuration.model).toBe('sonnet')

  const perChat = await resolveHarnessConfiguration(root, undefined, {
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
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-cross-'))
  roots.push(root)
  updateSettings(root, { agentModel: { harness: 'claude', model: 'sonnet' } })

  const codex = await resolveHarnessConfiguration(root, getHarnessById('codex'))
  expect(codex.ok).toBe(true)
  if (!codex.ok) return
  expect(codex.configuration.model).toBe('gpt-5.6-sol')
})
