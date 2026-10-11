import type { AgentRunSnapshot, ChatInfo, ChatList, HarnessStatus } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { AgentComposer } from './agent-tab'

/** The field itself, not any of the buttons around it. */
const fieldIsShut = (html: string) => /<textarea[^>]*\sdisabled=""/.test(html)
const CHAT = 'chat-1'
const chat = { id: CHAT, harness: 'claude' } as ChatInfo

/** This machine as it stands for Claude; Codex is installed beside it unless `noAgent`. */
function harness(ok: boolean, message: string, noAgent = false): HarnessStatus {
  const capabilities = {
    effortLevels: [],
    accessLevels: [],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  } as const
  const claude = { id: 'claude', label: 'Claude Code', bin: 'claude', ok, message, capabilities }
  const codex = { ...claude, id: 'codex', label: 'Codex', bin: 'codex', ok: !noAgent }
  return { ...claude, harnesses: [claude, codex], locked: false, source: 'default' }
}

function render(
  available: boolean | undefined,
  status: HarnessStatus,
  as: { bar?: boolean; expanded?: boolean } = {},
): string {
  const client = new QueryClient()
  client.setQueryData<ChatList>(qk.chats, { chats: [chat], activeId: CHAT })
  if (available !== undefined)
    client.setQueryData<AgentRunSnapshot>(qk.agent(CHAT), {
      chatId: CHAT,
      harness: 'claude',
      available,
      run: null,
      conversation: { active: false, turns: 0 },
    })
  client.setQueryData(qk.harness, status)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AgentComposer {...as} />
    </QueryClientProvider>,
  )
}

test('the field is shut until the agent answered, and then says nothing about itself', () => {
  const waiting = render(undefined, harness(true, 'ok'))
  expect(waiting).toContain('Connecting to Claude Code…')
  expect(fieldIsShut(waiting)).toBe(true)

  const ready = render(true, harness(true, 'ok'))
  expect(ready).toContain('Message the agent…')
  expect(fieldIsShut(ready)).toBe(false)
  expect(ready).not.toContain('Connecting to')
})

test('an agent that did not answer says what came back instead of just closing', () => {
  const html = render(false, harness(false, 'failed to spawn claude ACP agent: ENOENT'))
  expect(html).toContain('Claude Code unavailable')
  expect(html).toContain('failed to spawn claude ACP agent: ENOENT')
  expect(fieldIsShut(html)).toBe(true)
  // opened, the dock has room for the whole reason too
  expect(
    render(false, harness(false, 'claude ACP agent exited 127'), { bar: true, expanded: true }),
  ).toContain('>claude ACP agent exited 127<')
})

test('with no agent at all, the composer says which to install, and no wait outranks that', () => {
  for (const available of [false, undefined]) {
    const html = render(available, harness(false, 'not detected', true))
    expect(html).toContain('No coding agent found on this machine')
    expect(html).not.toContain('Claude Code unavailable')
    expect(html).not.toContain('Connecting to Claude Code…')
    expect(fieldIsShut(html)).toBe(true)
  }
})

test('the dock at rest keeps its one line: the waiting state rides in the row', () => {
  const html = render(undefined, harness(true, 'ok'), { bar: true })
  expect(html).toContain('aria-label="Connecting to Claude Code…"')
  expect(html).not.toContain('>Connecting to Claude Code…<')
})
