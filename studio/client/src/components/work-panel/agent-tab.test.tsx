import type { AgentRunSnapshot, ChatInfo, ChatList, HarnessStatus } from '@shared/types'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { qk } from '@/lib/api'

import { AgentComposer } from './agent-tab'

/** The field itself, not any of the buttons around it. */
const fieldIsShut = (html: string) => /<textarea[^>]*\sdisabled=""/.test(html)

const DOMAIN = 'billing'
const CHAT = 'chat-1'

const chat: ChatInfo = {
  id: CHAT,
  title: 'Work',
  harness: 'claude',
  turns: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  status: 'idle',
  queued: [],
}

const capabilities = {
  effortLevels: [],
  accessLevels: [],
  ask: true,
  loadout: true,
  gateway: 'anthropic',
} as const

function harnessStatus(ok: boolean, message: string): HarnessStatus {
  const presence = { id: 'claude', label: 'Claude Code', bin: 'claude', ok, message, capabilities }
  return { ...presence, harnesses: [presence], locked: false, source: 'default' }
}

/**
 * The composer as it stands for one answer from `GET /agent` — or for no answer
 * at all, which is the state this file exists for.
 */
function render(
  snapshot?: AgentRunSnapshot,
  harness?: HarnessStatus,
  as: { bar?: boolean; expanded?: boolean } = {},
): string {
  const client = new QueryClient()
  client.setQueryData<ChatList>(qk.chats(DOMAIN), { chats: [chat], activeId: CHAT })
  if (snapshot) client.setQueryData(qk.agent(DOMAIN, CHAT), snapshot)
  if (harness) client.setQueryData(qk.harness(DOMAIN), harness)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AgentComposer domainId={DOMAIN} {...as} />
    </QueryClientProvider>,
  )
}

const snapshot = (available: boolean): AgentRunSnapshot => ({
  chatId: CHAT,
  harness: 'claude',
  available,
  run: null,
  conversation: { active: false, turns: 0 },
})

test('while the ACP handshake is out, the composer waits — visibly, and shut', () => {
  const html = render(undefined, harnessStatus(true, 'Claude Agent initialized over ACP v1'))

  // the line names the agent it is waiting on; the field says only what that
  // means for the caret in it — the same sentence twice is what a bar cannot afford
  expect(html).toContain('Connecting to Claude Code…')
  expect(html).toContain('placeholder="Connecting…"')
  expect(html).toContain('animate-spin')
  // shut, so an Enter cannot vanish into an agent that is not on the other end yet
  expect(fieldIsShut(html)).toBe(true)
  expect(html).toContain('Connecting to Claude Code — nothing can be sent yet')
  expect(html).not.toContain('Message the agent…')
})

test('an agent that answered opens the field and says nothing about itself', () => {
  const html = render(snapshot(true), harnessStatus(true, 'Claude Agent initialized over ACP v1'))

  expect(html).toContain('Message the agent…')
  expect(fieldIsShut(html)).toBe(false)
  expect(html).not.toContain('Connecting to')
  expect(html).not.toContain('animate-spin')
})

test('an agent that did not answer says what came back instead of just closing', () => {
  const html = render(
    snapshot(false),
    harnessStatus(false, 'failed to spawn claude ACP agent: ENOENT'),
  )

  // the probe's own words: "unavailable" alone is what sent people hunting in
  // the studio for a fault that was in the agent
  expect(html).toContain('failed to spawn claude ACP agent: ENOENT')
  expect(html).toContain('Claude Code unavailable')
  expect(fieldIsShut(html)).toBe(true)
  // a wait is over, so nothing spins — this one needs a fix, not patience
  expect(html).not.toContain('animate-spin')
})

test('the dock at rest keeps its one line: the state rides in the row, not above it', () => {
  const html = render(undefined, harnessStatus(true, 'ok'), { bar: true })

  // the spinner is there — a wait has to look like one — but it is an icon on the
  // row, and the sentence it would have taken a line to say is on its title
  expect(html).toContain('animate-spin')
  expect(html).toContain('aria-label="Connecting to Claude Code…"')
  expect(html).toContain('placeholder="Connecting…"')
  // and nothing was added above the field: the bar is one line, resting
  expect(html).not.toContain('>Connecting to Claude Code…<')
})

test('opened, the dock can afford the whole sentence — and the reason with it', () => {
  const html = render(snapshot(false), harnessStatus(false, 'claude ACP agent exited 127'), {
    bar: true,
    expanded: true,
  })

  expect(html).toContain('>claude ACP agent exited 127<')
  expect(fieldIsShut(html)).toBe(true)
})
