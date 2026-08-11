import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { updateSettings } from '../../state/settings'
import {
  getHarness,
  getHarnessSelection,
  resolveHarnessConfiguration,
  setHarnessSelection,
} from './selection'

const roots: string[] = []
const previous = process.env.DOMAIN_STUDIO_HARNESS

afterEach(() => {
  if (previous === undefined) delete process.env.DOMAIN_STUDIO_HARNESS
  else process.env.DOMAIN_STUDIO_HARNESS = previous
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('persists a per-domain Codex selection', () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  const rootA = mkdtempSync(join(tmpdir(), 'studio-harness-a-'))
  const rootB = mkdtempSync(join(tmpdir(), 'studio-harness-b-'))
  roots.push(rootA, rootB)
  expect(getHarnessSelection(rootA)).toMatchObject({ id: 'claude', source: 'default' })
  expect(getHarnessSelection(rootB)).toMatchObject({ id: 'claude', source: 'default' })

  setHarnessSelection(rootA, 'codex')
  expect(getHarnessSelection(rootA)).toEqual({
    id: 'codex',
    locked: false,
    source: 'domain',
  })
  expect(getHarness(rootA).id).toBe('codex')
  expect(getHarnessSelection(rootB)).toEqual({
    id: 'claude',
    locked: false,
    source: 'default',
  })
  expect(getHarness(rootB).id).toBe('claude')
})

test('environment selection locks the GUI override', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-'))
  roots.push(root)
  process.env.DOMAIN_STUDIO_HARNESS = 'codex'
  expect(getHarnessSelection(root)).toEqual({
    id: 'codex',
    locked: true,
    source: 'environment',
  })
  expect(() => setHarnessSelection(root, 'claude')).toThrow('locked to codex')
})

test('resolves persisted Claude max and Ultracode effort modes', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-effort-'))
  roots.push(root)
  updateSettings(root, { agentEffort: 'max' })

  const resolved = await resolveHarnessConfiguration(root)
  expect(resolved.ok).toBe(true)
  if (!resolved.ok) return
  expect(resolved.configuration.harness.id).toBe('claude')
  expect(resolved.configuration.effort).toBe('max')

  updateSettings(root, { agentEffort: 'ultracode' })
  const ultracode = await resolveHarnessConfiguration(root)
  expect(ultracode.ok).toBe(true)
  if (!ultracode.ok) return
  expect(ultracode.configuration.effort).toBe('ultracode')
})
