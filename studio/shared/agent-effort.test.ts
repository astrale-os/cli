import { expect, test } from 'bun:test'

import { effectiveAgentEffort, isAgentEffort } from './agent-effort'

test('maps a chosen level onto the ladder the model actually offers', () => {
  expect(effectiveAgentEffort(['low', 'medium', 'high', 'xhigh'], 'max')).toBe('xhigh')
  expect(effectiveAgentEffort(['low', 'medium', 'high', 'xhigh'], 'ultracode')).toBe('xhigh')
  expect(effectiveAgentEffort(['low', 'medium', 'high'], 'minimal')).toBe('low')
  expect(effectiveAgentEffort(['medium', 'high'], 'xhigh')).toBe('high')
  expect(effectiveAgentEffort(['medium'], 'low')).toBe('medium')
  // Claude's own top rung is `max`; Codex answers `ultra` — each maps to the other
  expect(effectiveAgentEffort(['low', 'medium', 'high', 'xhigh', 'max'], 'ultra')).toBe('max')
  expect(
    effectiveAgentEffort(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'ultracode'),
  ).toBe('ultra')
})

test('an unknown or absent level leaves the agent on its own setting', () => {
  expect(effectiveAgentEffort(['low'], undefined)).toBeUndefined()
  expect(effectiveAgentEffort(['low', 'high'], 'turbo')).toBeUndefined()
  expect(effectiveAgentEffort([], 'high')).toBeUndefined()
})

test('recognizes the shared vocabulary', () => {
  expect(isAgentEffort('xhigh')).toBe(true)
  expect(isAgentEffort('default')).toBe(false)
})
