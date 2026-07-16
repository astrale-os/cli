import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AskResult } from './harness/adapter'

import { registerDomain, unregisterDomain } from '../domain'
import { getHarnessById } from './harness/registry'
import { handleAgentRoute } from './routes'
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
  writeFileSync(join(root, 'domain.ts'), 'export default {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const Test = {}\n')
  const handle = registerDomain(root)!
  domainIds.push(handle.id)
  return handle
}

async function route(rest: string, method = 'GET', body: any = {}) {
  const handle = fixture()
  const url = new URL(`http://127.0.0.1/api/domain/${handle.id}${rest}`)
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

test('ignores non-agent routes and rejects unknown agent routes', async () => {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  expect(await route('/context')).toBeNull()
  expect((await route('/agent/unknown'))?.status).toBe(404)
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
