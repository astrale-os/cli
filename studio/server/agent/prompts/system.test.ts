import { expect, test } from 'bun:test'

import { buildSystemPrompt } from './system'

test('embedded agents receive the current SDK and frontend skill contracts', () => {
  const prompt = buildSystemPrompt({ bridge: false })

  expect(prompt).toContain('modular Actions and Workflows')
  expect(prompt).toContain('astrale-frontend-design')
  expect(prompt).toContain('Runtime/Application entries')
  expect(prompt).not.toContain('schema/ runtime/ views/')
})
