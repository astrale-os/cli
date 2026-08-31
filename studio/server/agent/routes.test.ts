import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../shared/types'
import type { JsonRecord } from '../json'
import type { AskResult } from './harness/adapter'

import { registerDomain, unregisterDomain } from '../domain'
import { getHarnessById } from './harness/registry'
import { handleAgentRoute } from './routes'
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

test('serves the bounded persisted conversation history', async () => {
  const handle = fixture()
  const saved = (id: string, createdAt: string): AgentRun => ({
    id,
    domainId: handle.id,
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
  expect(await staleSession?.json()).toEqual({
    error: 'selected harness changed from codex to mock',
  })

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
      tools: [],
      mcpServers: [],
      skills: [],
      agents: [],
      builtinCommandCount: 0,
      probedAt: Date.now(),
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
