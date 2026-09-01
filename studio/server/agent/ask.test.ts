import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerDomain, unregisterDomain } from '../domain'
import { updateSettings } from '../state/settings'
import { initWorkspaceState } from '../workspace-state'
import { runAsk } from './ask'
import { activeChat, createChat, recordChatTurn, setActiveChat } from './chats'

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

test('Ask uses the active chat model and forks the session of that chat alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-ask-model-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'))
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const Test = {}\n')
  writeFileSync(
    join(root, 'application.ts'),
    `import { defineApplication } from '@astrale-os/sdk/application'
import { Test } from './schema/index.js'
export default defineApplication({ schema: Test, runtime: {} as never })
`,
  )
  const handle = registerDomain(root)!
  domainIds.push(handle.id)
  // Studio settings are global; point that global at this test's root.
  initWorkspaceState(root)

  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL = 'mock-selected-model'
  process.env.DOMAIN_STUDIO_MOCK_EXPECT_SESSION = 'mock-parent-session'
  updateSettings(root, { agentModel: { harness: 'mock', model: 'mock-selected-model' } })
  const chat = activeChat(root, 'mock')
  recordChatTurn(root, chat.id, { sessionId: 'mock-parent-session', turns: 2 })
  // A second tab on another agent must not lend Ask its session id.
  const other = createChat(root, { harness: 'claude' })
  recordChatTurn(root, other.id, { sessionId: 'claude-other-session', turns: 4 })
  setActiveChat(root, chat.id)

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
