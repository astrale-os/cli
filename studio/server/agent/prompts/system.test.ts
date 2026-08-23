import { expect, test } from 'bun:test'

import { buildSystemPrompt } from './system'

test('embedded agents receive the current SDK layout contract', () => {
  const prompt = buildSystemPrompt({ bridge: false })

  expect(prompt).toContain('modular Actions and Workflows')
  expect(prompt).toContain('pre-Kernel-V2 APIs or layouts')
  expect(prompt).toContain('Runtime/Application entries')
  expect(prompt).toContain('do not restore defineDomain or Interface-era layouts')
  expect(prompt).not.toContain('schema/ runtime/ views/')
})
