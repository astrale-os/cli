import { afterEach, expect, test } from 'bun:test'

import type { AgentRun, AgentSubmitResult, ChatInfo, StudioEvent } from '../../shared/types'
import type { JsonRecord } from '../json'
import type { AskResult } from './harness/adapter'

import { updateStudioSettings } from '../state/settings'
import { disposeTestDomains, testDomain } from '../test-domain'
import { setHarnessGateway } from './harness/gateway/config'
import { getHarnessById } from './harness/registry'
import { handleAgentRoute } from './routes'
import { cancelRun, listChats } from './run/coordinator'
import { persistRun } from './run/transcript'
import { agentWorkspace } from './workspace'

const replaced: (() => void)[] = []
afterEach(() => {
  for (const restore of replaced.splice(0)) restore()
  disposeTestDomains()
})

/** Stand in for one harness method for the length of a test. */
function replace<K extends 'health' | 'loadout' | 'ask'>(
  id: string,
  method: K,
  value: ReturnType<typeof getHarnessById>[K],
): void {
  const harness = getHarnessById(id)
  const original = harness[method]
  harness[method] = value
  replaced.push(() => (harness[method] = original))
}

async function call(
  rest: string,
  body?: JsonRecord,
  notify: (event: StudioEvent) => void = () => {},
  search = '',
) {
  const url = new URL(`http://127.0.0.1/api${rest}${search}`)
  const req = new Request(url, body ? { method: 'POST' } : {})
  return handleAgentRoute({ req, url, rest, body: body ?? {}, notify })
}

async function answer<T>(rest: string, body?: JsonRecord, search = ''): Promise<T> {
  return (await (await call(rest, body, undefined, search))!.json()) as T
}

test('only /agent paths are owned, and an unknown one is a 404', async () => {
  testDomain()
  expect(await call('/settings')).toBeNull()
  expect((await call('/agent/unknown'))?.status).toBe(404)
})

test('harness status names the running agent and every local one beside it', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const status = await answer<{
    id: string
    locked: boolean
    source: string
    harnesses: { id: string }[]
  }>('/agent/harness')
  expect(status).toMatchObject({ id: 'mock', locked: true, source: 'environment' })
  expect(status.harnesses.map((entry) => entry.id).sort()).toEqual(['claude', 'codex', 'mock'])
})

test('a chat update keeps only levels of the shared vocabulary', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const chatId = listChats().activeId
  const update = (patch: JsonRecord) =>
    answer<ChatInfo>('/agent/chats', { action: 'update', chatId, ...patch })

  expect(await update({ effort: 'xhigh', fastMode: true })).toMatchObject({
    effort: 'xhigh',
    fastMode: true,
    status: 'idle',
  })
  expect(await update({ effort: 'turbo' })).not.toHaveProperty('effort')
})

test('reordering the tabs persists and tells every window', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const first = listChats().activeId
  const second = (await answer<ChatInfo>('/agent/chats', { action: 'open' })).id
  const events: StudioEvent[] = []

  await call('/agent/chats', { action: 'reorder', order: [second, first] }, (event) =>
    events.push(event),
  )
  expect(listChats().chats.map((chat) => chat.id)).toEqual([second, first])
  expect(events).toContainEqual({ type: 'chats' })
})

test('serves the bounded persisted conversation history', async () => {
  testDomain()
  const chatId = listChats().activeId
  for (const [id, hour] of [
    ['older', 1],
    ['newer', 2],
  ] as const)
    persistRun(
      agentWorkspace().stateRoot,
      {
        id,
        chatId,
        harness: 'codex',
        status: 'succeeded',
        createdAt: `2026-08-20T0${hour}:00:00.000Z`,
        summary: id,
        targetCommentIds: [],
        events: [],
      },
      true,
    )

  expect(await answer<AgentRun[]>('/agent/history', undefined, '?limit=1')).toEqual([
    expect.objectContaining({ id: 'newer' }),
  ])
})

test('a session id is refused on a chat of another agent, and so is an invalid gateway', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  const chat = await answer<ChatInfo>('/agent/chats', { action: 'open', harness: 'codex' })

  const wrong = await call('/agent/session', { chatId: chat.id, harness: 'claude', sessionId: 'x' })
  expect(wrong?.status).toBe(400)
  expect(await wrong?.json()).toEqual({ error: 'this chat runs codex, not claude' })
  expect(
    await answer('/agent/session', { chatId: chat.id, harness: 'codex', sessionId: 'thread' }),
  ).toMatchObject({ sessionId: 'thread', harness: 'codex' })

  const gateway = await call('/agent/harness-gateway', {
    action: 'set',
    config: { enabled: true, baseUrl: '', auth: { mode: 'mint' } },
  })
  expect(gateway?.status).toBe(400)
  expect(await gateway?.json()).toEqual({ error: 'gateway base URL is required while enabled' })
})

test('the loadout fails closed instead of probing ambient Claude when gateway auth fails', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'claude'
  let probes = 0
  replace('claude', 'loadout', async () => {
    probes++
    throw new Error('ambient Claude must not be probed')
  })
  setHarnessGateway({
    enabled: true,
    baseUrl: 'https://gateway.example/v1/models/test',
    auth: { mode: 'host' },
  })

  const body = await answer<{ ok: boolean; detail: string }>('/agent/loadout')
  expect(body.ok).toBe(false)
  expect(body.detail).toContain('no valid host-supplied token')
  expect(probes).toBe(0)
})

test('closing an Ask stream aborts the harness and nothing is enqueued after', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  let finished!: () => void
  const done = new Promise<void>((resolve) => (finished = resolve))
  let aborted = false
  replace('mock', 'ask', async (input): Promise<AskResult> => {
    input.onDelta('first')
    await new Promise<void>((resolve) =>
      input.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    aborted = true
    input.onDelta('late')
    finished()
    return { text: 'firstlate', isError: false }
  })

  const reader = (await call('/agent/ask', { question: 'stream briefly' }))!.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"delta":"first"')
  await reader.cancel()
  await done
  expect(aborted).toBe(true)
})

test('the model catalog offers every harness, ticks Studio’s default, and falls back', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  replace('claude', 'health', async () => ({ ok: true, bin: 'claude', version: '1.0' }))
  replace('codex', 'health', async () => ({ ok: false, bin: 'codex', detail: 'not on PATH' }))
  let models = [
    { id: 'fable', label: 'Fable' },
    { id: 'opus[1m]', label: 'Opus (1M context)' },
  ]
  replace('claude', 'loadout', async () => ({
    ok: true,
    nativeModel: 'fable',
    models,
    probedAt: Date.now(),
    source: 'acp',
  }))
  interface Entry {
    harness: string
    available: boolean
    detail?: string
    defaultModel?: string
    models: unknown[]
  }
  const catalog = async () =>
    Object.fromEntries(
      (await answer<Entry[]>('/agent/models')).map((entry) => [entry.harness, entry]),
    )

  const listed = await catalog()
  expect(listed.claude).toMatchObject({ available: true, defaultModel: 'opus[1m]' })
  // an uninstalled agent is still offered, with the reason it cannot be picked
  expect(listed.codex).toMatchObject({ available: false, detail: 'not on PATH', models: [] })
  expect(listed.mock).toMatchObject({ available: true, models: [] })

  // a starred slug the agent renamed falls back to Studio's default, not the agent's own pick
  updateStudioSettings({ agentModel: { harness: 'claude', model: 'opus' } })
  expect((await catalog()).claude?.defaultModel).toBe('opus[1m]')
  // once the agent drops that default too, its own pick is the only honest one
  models = [{ id: 'fable', label: 'Fable' }]
  expect((await catalog()).claude?.defaultModel).toBe('fable')
})

test('the queue route parks a message behind a turn and announces every change', async () => {
  testDomain()
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = '5000'
  const events: StudioEvent[] = []
  const post = (rest: string, body: JsonRecord) => call(rest, body, (event) => events.push(event))
  const submit = async (message: string) =>
    (await (await post('/agent/submit', { message }))!.json()) as AgentSubmitResult

  expect((await submit('the long one')).run?.status).toBe('running')
  const parked = await submit('wait for me')
  expect(parked.run).toBeUndefined()
  expect(parked.queued?.text).toBe('wait for me')

  const edited = (await (await post('/agent/queue', {
    action: 'edit',
    id: parked.queued!.id,
    message: 'on reflection',
  }))!.json()) as ChatInfo
  expect(edited.queued.map((message) => message.text)).toEqual(['on reflection'])
  expect(events.filter((event) => event.type === 'chats').length).toBeGreaterThanOrEqual(2)

  expect((await post('/agent/queue', { action: 'remove', id: 'not-a-message' }))?.status).toBe(400)
  const unknown = await post('/agent/queue', { action: 'shuffle' })
  expect(await unknown?.json()).toEqual({ error: 'unknown queue action: shuffle' })
  expect(cancelRun()).toBe(true)
})
