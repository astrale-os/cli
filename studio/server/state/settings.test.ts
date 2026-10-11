import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readSettings, updateSettings } from './settings'
import { writeJson } from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('remembers one sanitized preferred model, and lets it be cleared', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-settings-model-'))
  roots.push(root)

  const saved = updateSettings(root, {
    agentModel: { harness: ' Codex ', model: ' gpt-5.6-sol ' },
  })
  expect(saved.agentModel).toEqual({ harness: 'codex', model: 'gpt-5.6-sol' })
  expect(readSettings(root).agentModel).toEqual(saved.agentModel)

  // Starring another one moves it: there is one preference, not one per agent.
  expect(
    updateSettings(root, { agentModel: { harness: 'claude', model: 'opus[1m]' } }),
  ).toMatchObject({ agentModel: { harness: 'claude', model: 'opus[1m]' } })
  expect(updateSettings(root, { agentModel: null }).agentModel).toBeNull()
})

test('rejects malformed preferences without discarding unrelated settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-settings-bad-model-'))
  roots.push(root)
  writeJson(root, 'settings.json', { agentModel: ['gpt-bad'], agentAccess: 'workspace' })

  const settings = readSettings(root)
  expect(settings.agentModel).toBeNull()
  expect(settings.agentAccess).toBe('workspace')

  writeJson(root, 'settings.json', { agentModel: { harness: 'claude' } })
  expect(readSettings(root).agentModel).toBeNull()
})

test('drops destructive timing values from disk and API patches', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-settings-timings-'))
  roots.push(root)
  writeJson(root, 'settings.json', {
    introspectTimeoutMs: -1,
    instancePollMs: 1_000.5,
    updatesPollMs: 9_999,
    viewProbeTimeoutMs: 120_001,
  })

  expect(readSettings(root)).toMatchObject({
    introspectTimeoutMs: 60_000,
    instancePollMs: 30_000,
    updatesPollMs: 600_000,
    viewProbeTimeoutMs: 8_000,
  })

  const saved = updateSettings(root, {
    introspectTimeoutMs: Number.POSITIVE_INFINITY,
    instancePollMs: 1_000,
    updatesPollMs: 86_400_000,
    viewProbeTimeoutMs: 250,
  })
  expect(saved).toMatchObject({
    introspectTimeoutMs: 60_000,
    instancePollMs: 1_000,
    updatesPollMs: 86_400_000,
    viewProbeTimeoutMs: 250,
  })
})
