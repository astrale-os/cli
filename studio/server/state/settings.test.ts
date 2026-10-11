import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { studioHome } from './home'
import { studioSettings, updateStudioSettings } from './settings'
import { writeJson } from './store'

const previousHome = process.env.ASTRALE_HOME
let home = ''

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'studio-settings-'))
  process.env.ASTRALE_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.ASTRALE_HOME
  else process.env.ASTRALE_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

test('remembers one sanitized preferred model, and lets it be cleared', () => {
  const saved = updateStudioSettings({ agentModel: { harness: ' Codex ', model: ' gpt-5.6-sol ' } })
  expect(saved.agentModel).toEqual({ harness: 'codex', model: 'gpt-5.6-sol' })
  expect(studioSettings().agentModel).toEqual(saved.agentModel)
  expect(updateStudioSettings({ agentModel: null }).agentModel).toBeNull()
})

test('drops malformed and destructive values without discarding the rest', () => {
  writeJson(studioHome(), 'settings.json', {
    agentModel: { harness: 'claude' },
    agentAccess: 'workspace',
    introspectTimeoutMs: -1,
    updatesPollMs: 9_999,
  })
  expect(studioSettings()).toMatchObject({
    agentModel: null,
    agentAccess: 'workspace',
    introspectTimeoutMs: 60_000,
    updatesPollMs: 600_000,
  })
  expect(
    updateStudioSettings({ instancePollMs: Number.POSITIVE_INFINITY, viewProbeTimeoutMs: 250 }),
  ).toMatchObject({ instancePollMs: 30_000, viewProbeTimeoutMs: 250 })
})
