import { afterEach, expect, test } from 'bun:test'

import { updateStudioSettings } from '../state/settings'
import { disposeTestDomains, testDomain } from '../test-domain'
import { runAsk } from './ask'
import { activeChat, createChat, recordChatTurn, setActiveChat } from './chats'
import { agentWorkspace } from './workspace'

afterEach(disposeTestDomains)

test('Ask uses the active chat model and forks the session of that chat alone', async () => {
  const handle = testDomain()
  const workspace = agentWorkspace()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  // the mock refuses any other model or parent session than these
  process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL = 'mock-selected-model'
  process.env.DOMAIN_STUDIO_MOCK_EXPECT_SESSION = 'mock-parent-session'
  updateStudioSettings({ agentModel: { harness: 'mock', model: 'mock-selected-model' } })
  const chat = activeChat(workspace.stateRoot, 'mock', undefined, workspace.uiRoot)
  recordChatTurn(workspace.stateRoot, chat.id, { sessionId: 'mock-parent-session', turns: 2 })
  // a second tab on another agent must not lend Ask its session id
  const other = createChat(workspace.stateRoot, { harness: 'claude' })
  recordChatTurn(workspace.stateRoot, other.id, { sessionId: 'claude-other-session', turns: 4 })
  setActiveChat(workspace.stateRoot, chat.id, workspace.uiRoot)

  const deltas: string[] = []
  const result = await runAsk(
    workspace,
    { question: 'Which context is active?', domainId: handle.id },
    new AbortController().signal,
    (delta) => deltas.push(delta),
  )

  expect(result.isError).toBe(false)
  expect(result.text).toStartWith('(forked from mock-par…)')
  expect(deltas.join('')).toBe(result.text)
})
