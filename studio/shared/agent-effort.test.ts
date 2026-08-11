import { expect, test } from 'bun:test'

import { effectiveAgentEffort } from './agent-effort'

test('normalizes persisted effort when switching harness vocabularies', () => {
  expect(effectiveAgentEffort(['low', 'medium', 'high', 'xhigh'], 'max')).toBe('xhigh')
  expect(effectiveAgentEffort(['low', 'medium', 'high', 'xhigh'], 'ultracode')).toBe('xhigh')
  expect(effectiveAgentEffort(['low', 'medium', 'high'], 'minimal')).toBe('low')
  expect(effectiveAgentEffort(['medium', 'high'], 'xhigh')).toBe('high')
  expect(effectiveAgentEffort(['medium'], 'low')).toBe('medium')
  expect(effectiveAgentEffort(['low'], undefined)).toBeUndefined()
})
