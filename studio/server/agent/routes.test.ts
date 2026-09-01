import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../shared/types'
import type { JsonRecord } from '../json'
import type { AskResult } from './harness/adapter'

import { registerDomain, unregisterDomain } from '../domain'
import { updateSettings } from '../state/settings'
import { initWorkspaceState } from '../workspace-state'
import { markHandoffDelivered } from './chats'
import { getHarnessById } from './harness/registry'
import { handleAgentRoute } from './routes'
import { listChats } from './run/coordinator'
import { persistRun } from './run/transcript'
import { NdjsonChannel } from './stream'

const roots: string[] = []
const domainIds: string[] = []
const previousHarness = process.env.DOMAIN_STUDIO_HARNESS

afterEach(() => {
  if (previousHarness === undefined) delete process.env.DOMAIN_STUDIO_HARNESS
  else process.env.DOMAIN_STUDIO_HARNESS = previousHarness
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-routes-'))
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
  return handle
}

async function route(rest: string, method = 'GET', body: JsonRecord = {}, search = '') {
  const handle = fixture()
  const url = new URL(`http://127.0.0.1/api/domain/${handle.id}${rest}${search}`)
  const req = new Request(url, {
    method,
    ...(method === 'POST'
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
  return handleAgentRoute({ req, url, rest, body, handle, notify: () => {} })
}

test('owns harness status and prompt routes behind one agent boundary', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'

  const harness = await route('/agent/harness')
  expect(harness?.status).toBe(200)
  expect(await harness?.json()).toMatchObject({
    id: 'mock',
    label: 'Mock agent (free)',
    ok: true,
    locked: true,
    source: 'environment',
  })

  const prompt = await route('/agent/prompt/system')
  expect(await prompt?.json()).toMatchObject({
    bridge: true,
  })
})

test('harness status reports every local agent, not just the one in use', async () => {
  delete process.env.DOMAIN_STUDIO_HARNESS
  const status = (await (await route('/agent/harness'))?.json()) as {
    id: string
    harnesses: { id: string; ok: boolean; capabilities: { effortLevels: string[] } }[]
  }

  expect(status.id).toBe('claude')
  expect(status.harnesses.map((entry) => entry.id).sort()).toEqual(['claude', 'codex'])
  // each one carries the ladder the composer falls back on before its ACP probe lands
  for (const entry of status.harnesses)
    expect(entry.capabilities.effortLevels.length).toBeGreaterThan(0)
})

test('a chat pins its own reasoning level, and the turn carries it', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const handle = fixture()
  const chatId = listChats(handle.id).activeId
  const patch = async (effort: string) => {
    const url = new URL(`http://127.0.0.1/api/domain/${handle.id}/agent/chats`)
    const body = { action: 'update', chatId, effort }
    return (await (
      await handleAgentRoute({
        req: new Request(url, { method: 'POST' }),
        url,
        rest: '/agent/chats',
        body,
        handle,
        notify: () => {},
      })
    )?.json()) as { effort?: string }
  }

  expect(await patch('xhigh')).toMatchObject({ effort: 'xhigh' })
  // a level outside the shared vocabulary is refused rather than stored
  expect(await patch('turbo')).not.toHaveProperty('effort')
  expect(await patch('max')).toMatchObject({ effort: 'max' })
  // clearing it hands the choice back to the agent's own configuration
  expect(await patch('')).not.toHaveProperty('effort')
})

test('serves the bounded persisted conversation history', async () => {
  const handle = fixture()
  const chatId = listChats(handle.id).activeId
  const saved = (id: string, createdAt: string): AgentRun => ({
    id,
    domainId: handle.id,
    chatId,
    harness: 'codex',
    status: 'succeeded',
    createdAt,
    summary: id,
    instruction: `Do ${id}`,
    targetCommentIds: [],
    events: [],
  })
  persistRun(handle.root, saved('older', '2026-08-20T01:00:00.000Z'), true)
  persistRun(handle.root, saved('newer', '2026-08-20T02:00:00.000Z'), true)

  const url = new URL(`http://127.0.0.1/api/domain/${handle.id}/agent/history?limit=1`)
  const response = await handleAgentRoute({
    req: new Request(url),
    url,
    rest: '/agent/history',
    body: {},
    handle,
    notify: () => {},
  })

  expect(response?.status).toBe(200)
  expect(await response?.json()).toEqual([expect.objectContaining({ id: 'newer' })])
})

test('ignores non-agent routes and rejects unknown agent routes', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  expect(await route('/settings')).toBeNull()
  expect((await route('/agent/unknown'))?.status).toBe(404)
})

test('rejects stale session ownership and invalid gateway writes at the route boundary', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'

  const staleSession = await route('/agent/session', 'POST', {
    harness: 'codex',
    sessionId: 'wrong-owner',
  })
  expect(staleSession?.status).toBe(400)
  expect(await staleSession?.json()).toEqual({ error: 'this chat runs mock, not codex' })

  const invalidGateway = await route('/agent/harness-gateway', 'POST', {
    action: 'set',
    scope: 'domain',
    config: { enabled: true, baseUrl: '', auth: { mode: 'mint' } },
  })
  expect(invalidGateway?.status).toBe(400)
  expect(await invalidGateway?.json()).toEqual({
    error: 'gateway base URL is required while enabled',
  })
})

test('threads an explicit loadout refresh through to the selected harness', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'claude'
  const harness = getHarnessById('claude')
  const originalLoadout = harness.loadout
  let refresh: boolean | undefined
  harness.loadout = async (_root, options) => {
    refresh = options?.refresh
    return {
      ok: true,
      probedAt: Date.now(),
      source: 'acp',
    }
  }

  try {
    const response = await route('/agent/loadout', 'GET', {}, '?refresh=1')
    expect(response?.status).toBe(200)
    expect(refresh).toBe(true)
  } finally {
    harness.loadout = originalLoadout
  }
})

test('cancels an Ask stream without enqueueing after the client closes it', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const harness = getHarnessById('mock')
  const originalAsk = harness.ask
  let finishAsk!: () => void
  const askFinished = new Promise<void>((resolve) => (finishAsk = resolve))
  let receivedAbort = false
  harness.ask = async (input): Promise<AskResult> => {
    input.onDelta('first')
    await new Promise<void>((resolve) => {
      input.signal.addEventListener(
        'abort',
        () => {
          receivedAbort = true
          resolve()
        },
        { once: true },
      )
    })
    input.onDelta('late')
    finishAsk()
    return { text: 'firstlate', isError: false }
  }

  try {
    const response = await route('/agent/ask', 'POST', { question: 'stream briefly' })
    const reader = response!.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"delta":"first"')
    await reader.cancel()
    await askFinished
    expect(receivedAbort).toBe(true)
  } finally {
    harness.ask = originalAsk
  }
})

test('an NDJSON channel never enqueues after cancellation', () => {
  const abortController = new AbortController()
  const chunks: Uint8Array[] = []
  const target = {
    enqueue: (chunk: Uint8Array) => chunks.push(chunk),
    close: () => {},
  } as unknown as ReadableStreamDefaultController<Uint8Array>
  const channel = new NdjsonChannel(target, abortController)

  expect(channel.send({ delta: 'first' })).toBe(true)
  channel.cancel()
  expect(abortController.signal.aborted).toBe(true)
  expect(channel.send({ delta: 'late' })).toBe(false)
  expect(chunks).toHaveLength(1)
})

test('a session id is checked against the chat that owns it, not the domain default', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const handle = fixture()
  const call = async (rest: string, body: JsonRecord) => {
    const url = new URL(`http://127.0.0.1/api/domain/${handle.id}${rest}`)
    const req = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return handleAgentRoute({ req, url, rest, body, handle, notify: () => {} })
  }

  // a Codex tab in a domain whose default agent is something else entirely
  const opened = await call('/agent/chats', { action: 'open', harness: 'codex' })
  const chat = (await opened?.json()) as { id: string; harness: string }
  expect(chat.harness).toBe('codex')

  const wrong = await call('/agent/session', {
    chatId: chat.id,
    harness: 'claude',
    sessionId: 'from-another-agent',
  })
  expect(wrong?.status).toBe(400)
  expect(await wrong?.json()).toEqual({ error: 'this chat runs codex, not claude' })

  const right = await call('/agent/session', {
    chatId: chat.id,
    harness: 'codex',
    sessionId: 'codex-thread',
  })
  expect(right?.status).toBe(200)
  expect(await right?.json()).toMatchObject({ sessionId: 'codex-thread', harness: 'codex' })
})

test('the model catalog lists every harness, available or not', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const claude = getHarnessById('claude')
  const codex = getHarnessById('codex')
  const originals = {
    claudeHealth: claude.health,
    claudeLoadout: claude.loadout,
    codexHealth: codex.health,
  }
  claude.health = async () => ({ ok: true, bin: 'claude', version: '1.0' })
  claude.loadout = async () => ({
    ok: true,
    nativeModel: 'sonnet-5',
    models: [
      { id: 'sonnet-5', label: 'Sonnet 5', isDefault: true },
      { id: 'opus-5', label: 'Opus 5' },
    ],
    probedAt: Date.now(),
    source: 'acp',
  })
  codex.health = async () => ({ ok: false, bin: 'codex', detail: 'codex is not on your PATH' })

  try {
    const response = await route('/agent/models')
    expect(response?.status).toBe(200)
    const catalog = (await response?.json()) as {
      harness: string
      available: boolean
      detail?: string
      nativeModel?: string
      models: { id: string }[]
    }[]

    const byHarness = Object.fromEntries(catalog.map((entry) => [entry.harness, entry]))
    expect(byHarness.claude).toMatchObject({
      available: true,
      nativeModel: 'sonnet-5',
      models: [{ id: 'sonnet-5' }, { id: 'opus-5' }],
    })
    // an uninstalled agent is still offered, with the reason it cannot be picked
    expect(byHarness.codex).toMatchObject({
      available: false,
      detail: 'codex is not on your PATH',
      models: [],
    })
    // a harness that reports no models says so instead of pretending to have them
    expect(byHarness.mock).toMatchObject({ available: true, models: [] })
  } finally {
    claude.health = originals.claudeHealth
    claude.loadout = originals.claudeLoadout
    codex.health = originals.codexHealth
  }
})

test('picking a model of another agent forks a brand-new chat carrying it', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const handle = fixture()
  const call = async (rest: string, body: JsonRecord) => {
    const url = new URL(`http://127.0.0.1/api/domain/${handle.id}${rest}`)
    const req = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return handleAgentRoute({ req, url, rest, body, handle, notify: () => {} })
  }

  // an existing Codex tab: the fork must NOT reuse it
  const existing = (await (
    await call('/agent/chats', { action: 'open', harness: 'codex' })
  )?.json()) as { id: string }
  const source = (await (
    await call('/agent/chats', { action: 'open', harness: 'mock' })
  )?.json()) as { id: string }

  const forked = (await (
    await call('/agent/chats', {
      action: 'switch-harness',
      chatId: source.id,
      harness: 'codex',
      model: 'gpt-5.6-sol',
    })
  )?.json()) as { id: string; harness: string; model?: string; origin?: { chatId: string } }

  expect(forked.harness).toBe('codex')
  expect(forked.model).toBe('gpt-5.6-sol')
  expect(forked.id).not.toBe(existing.id)
  expect(forked.origin?.chatId).toBe(source.id)

  const url = new URL(`http://127.0.0.1/api/domain/${handle.id}/agent/chats`)
  const list = (await (
    await handleAgentRoute({
      req: new Request(url),
      url,
      rest: '/agent/chats',
      body: {},
      handle,
      notify: () => {},
    })
  )?.json()) as { chats: { id: string }[]; activeId: string }
  // the seeded tab plus all three: forking added a chat, it did not move into one
  expect(list.chats.map((chat) => chat.id)).toEqual(
    expect.arrayContaining([existing.id, source.id, forked.id]),
  )
  expect(list.chats).toHaveLength(4)
  expect(list.activeId).toBe(forked.id)
})

test('the catalog ticks Studio default model, and falls back when the harness drops it', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const claude = getHarnessById('claude')
  const codex = getHarnessById('codex')
  const originals = {
    claudeHealth: claude.health,
    claudeLoadout: claude.loadout,
    claudeDefault: claude.defaultModel,
    codexHealth: codex.health,
  }
  claude.health = async () => ({ ok: true, bin: 'claude', version: '1.0' })
  claude.defaultModel = 'opus[1m]'
  codex.health = async () => ({ ok: false, bin: 'codex', detail: 'not installed' })

  try {
    claude.loadout = async () => ({
      ok: true,
      nativeModel: 'fable',
      models: [
        { id: 'fable', label: 'Fable' },
        { id: 'opus[1m]', label: 'Opus (1M context)' },
      ],
      probedAt: Date.now(),
      source: 'acp',
    })
    const listed = (await (await route('/agent/models'))?.json()) as {
      harness: string
      defaultModel?: string
    }[]
    expect(listed.find((entry) => entry.harness === 'claude')?.defaultModel).toBe('opus[1m]')

    // a domain that starred a slug the agent has since renamed falls back to
    // Studio's default, not to whatever that machine is configured with
    const starred = fixture()
    // Studio settings are global; point that global at this fixture's root.
    initWorkspaceState(starred.root)
    updateSettings(starred.root, { agentModel: { harness: 'claude', model: 'opus' } })
    const staleUrl = new URL(`http://127.0.0.1/api/domain/${starred.id}/agent/models`)
    const stale = (await (
      await handleAgentRoute({
        req: new Request(staleUrl),
        url: staleUrl,
        rest: '/agent/models',
        body: {},
        handle: starred,
        notify: () => {},
      })
    )?.json()) as { harness: string; defaultModel?: string }[]
    expect(stale.find((entry) => entry.harness === 'claude')?.defaultModel).toBe('opus[1m]')

    // the harness stopped offering it too: ticking a model it would refuse is
    // worse than falling back to whatever it picks on its own
    claude.loadout = async () => ({
      ok: true,
      nativeModel: 'fable',
      models: [{ id: 'fable', label: 'Fable' }],
      probedAt: Date.now(),
      source: 'acp',
    })
    const dropped = (await (await route('/agent/models'))?.json()) as {
      harness: string
      defaultModel?: string
    }[]
    expect(dropped.find((entry) => entry.harness === 'claude')?.defaultModel).toBe('fable')
  } finally {
    claude.health = originals.claudeHealth
    claude.loadout = originals.claudeLoadout
    claude.defaultModel = originals.claudeDefault
    codex.health = originals.codexHealth
  }
})

test('a chat origin can only be forgotten before it reaches the agent', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const handle = fixture()
  const call = async (rest: string, body: JsonRecord) => {
    const url = new URL(`http://127.0.0.1/api/domain/${handle.id}${rest}`)
    const req = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return handleAgentRoute({ req, url, rest, body, handle, notify: () => {} })
  }

  const source = (await (
    await call('/agent/chats', { action: 'open', harness: 'mock' })
  )?.json()) as { id: string }
  const turn: AgentRun = {
    id: 'turn-1',
    domainId: handle.id,
    chatId: source.id,
    harness: 'mock',
    status: 'succeeded',
    createdAt: '2026-08-20T01:00:00.000Z',
    summary: 'renamed it',
    instruction: 'rename the Invoice class',
    targetCommentIds: [],
    events: [],
  }
  persistRun(handle.root, turn, true)
  const forked = (await (
    await call('/agent/chats', { action: 'switch-harness', chatId: source.id, harness: 'codex' })
  )?.json()) as { id: string; origin?: { summary: string } }
  expect(forked.origin?.summary).toContain('rename the Invoice class')

  const forgotten = (await (
    await call('/agent/chats', { action: 'forget-origin', chatId: forked.id })
  )?.json()) as { id: string; origin?: unknown }
  expect(forgotten.id).toBe(forked.id)
  expect(forgotten.origin).toBeUndefined()

  // the conversation it was forked from keeps its own tab and its transcript
  const chats = listChats(handle.id)
  expect(chats.chats.map((chat) => chat.id)).toContain(source.id)
  expect(chats.chats.find((chat) => chat.id === forked.id)?.origin).toBeUndefined()

  const delivered = (await (
    await call('/agent/chats', { action: 'switch-harness', chatId: source.id, harness: 'codex' })
  )?.json()) as { id: string; origin?: { summary: string } }
  markHandoffDelivered(handle.root, delivered.id)

  const refused = await call('/agent/chats', { action: 'forget-origin', chatId: delivered.id })
  expect(refused?.status).toBe(400)
  expect(await refused?.text()).toContain('already sent to the agent')
  expect(listChats(handle.id).chats.find((chat) => chat.id === delivered.id)?.origin).toBeDefined()
})
