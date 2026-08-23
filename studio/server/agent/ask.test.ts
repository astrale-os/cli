import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerDomain, unregisterDomain } from '../domain'
import { updateSettings } from '../state/settings'
import { runAsk } from './ask'
import { saveConversation } from './conversation'

const roots: string[] = []
const domainIds: string[] = []
const envBefore = {
  harness: process.env.DOMAIN_STUDIO_HARNESS,
  model: process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL,
  session: process.env.DOMAIN_STUDIO_MOCK_EXPECT_SESSION,
}

function restore(name: keyof typeof envBefore, variable: string): void {
  const value = envBefore[name]
  if (value === undefined) delete process.env[variable]
  else process.env[variable] = value
}

afterEach(() => {
  restore('harness', 'DOMAIN_STUDIO_HARNESS')
  restore('model', 'DOMAIN_STUDIO_MOCK_EXPECT_MODEL')
  restore('session', 'DOMAIN_STUDIO_MOCK_EXPECT_SESSION')
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('Ask uses the active harness model and matching per-harness conversation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-ask-model-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'))
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(join(root, 'application.ts'), 'export default {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const Test = {}\n')
  const handle = registerDomain(root)!
  domainIds.push(handle.id)

  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL = 'mock-selected-model'
  process.env.DOMAIN_STUDIO_MOCK_EXPECT_SESSION = 'mock-parent-session'
  updateSettings(root, {
    agentModels: {
      mock: 'mock-selected-model',
      claude: 'claude-other-model',
    },
  })
  saveConversation(root, 'mock', {
    sessionId: 'mock-parent-session',
    turns: 2,
    updatedAt: 'now',
  })
  saveConversation(root, 'claude', {
    sessionId: 'claude-other-session',
    turns: 4,
    updatedAt: 'now',
  })

  const deltas: string[] = []
  const result = await runAsk(
    handle,
    { question: 'Which context is active?' },
    new AbortController().signal,
    (delta) => deltas.push(delta),
  )

  expect(result.isError).toBe(false)
  expect(result.text).toStartWith('(forked from mock-par…)')
  expect(deltas.join('')).toBe(result.text)
})
