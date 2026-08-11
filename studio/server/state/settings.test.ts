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

test('remembers sanitized model overrides independently per harness', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-settings-models-'))
  roots.push(root)

  const saved = updateSettings(root, {
    agentModels: {
      ' Codex ': ' gpt-5.6-sol ',
      claude: ' opus ',
      empty: ' ',
    },
  })

  expect(saved.agentModels).toEqual({
    codex: 'gpt-5.6-sol',
    claude: 'opus',
  })
  expect(readSettings(root).agentModels).toEqual(saved.agentModels)
})

test('rejects malformed model maps and entries without discarding unrelated settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-settings-bad-models-'))
  roots.push(root)
  writeJson(root, 'settings.json', { agentModels: ['gpt-bad'], agentEffort: 'low' })

  const settings = readSettings(root)
  expect(settings.agentModels).toEqual({})
  expect(settings.agentEffort).toBe('low')

  writeJson(root, 'settings.json', {
    agentModels: { codex: null, claude: { id: 'opus' }, valid: ' model-ok ' },
  })
  expect(readSettings(root).agentModels).toEqual({ valid: 'model-ok' })
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
    introspectTimeoutMs: 20_000,
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
    introspectTimeoutMs: 20_000,
    instancePollMs: 1_000,
    updatesPollMs: 86_400_000,
    viewProbeTimeoutMs: 250,
  })
})
