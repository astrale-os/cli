import { expect, test } from 'bun:test'

import type { HarnessCapabilities } from '../../shared/types'

import { effectiveHarnessEffort } from './capabilities'

const capabilities = (effortLevels: HarnessCapabilities['effortLevels']): HarnessCapabilities => ({
  effortLevels,
  accessLevels: ['workspace', 'full'],
  ask: true,
  loadout: true,
  gateway: 'none',
})

test('normalizes persisted effort when switching between Codex and Claude', () => {
  const codex = capabilities(['minimal', 'low', 'medium', 'high', 'xhigh'])
  const claude = capabilities(['low', 'medium', 'high', 'xhigh', 'max'])

  expect(effectiveHarnessEffort(codex, 'max')).toBe('xhigh')
  expect(effectiveHarnessEffort(claude, 'minimal')).toBe('low')
  expect(effectiveHarnessEffort(codex, 'medium')).toBe('medium')
})
