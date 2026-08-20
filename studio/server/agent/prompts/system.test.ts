import { expect, test } from 'bun:test'

import { buildSystemPrompt } from './system'

test('embedded agents receive the current SDK layout contract', () => {
  const prompt = buildSystemPrompt({ bridge: false })

  expect(prompt).toContain('implementation.ts')
  expect(prompt).toContain('pre-Kernel-V2 APIs or layouts')
  expect(prompt).toContain('domain.ts/runtime only when this is already a legacy project')
  expect(prompt).not.toContain('schema/ runtime/ views/')
})
