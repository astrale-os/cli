import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCodexForkAsk } from './ask'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fakeCodex(root: string): string {
  const file = join(root, 'fake-codex')
  writeFileSync(
    file,
    `#!/usr/bin/env bun
let buffer = ''
const fs = require('node:fs')
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const record = (message) => {
  if (process.env.FAKE_APP_LOG) fs.appendFileSync(process.env.FAKE_APP_LOG, JSON.stringify(message) + '\\n')
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line)
    record(message)
    const fresh = process.env.FAKE_APP_EXPECT_FRESH === '1'
    if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } })
    if (message.method === 'thread/fork') {
      if (fresh) {
        send({ id: message.id, error: { message: 'unexpected fork' } })
      } else if (message.params.threadId !== 'parent-thread') {
        send({ id: message.id, error: { message: 'wrong parent' } })
      } else {
        send({ id: message.id, result: { thread: { id: 'fork-thread' } } })
      }
    }
    if (message.method === 'thread/start') {
      if (fresh) send({ id: message.id, result: { thread: { id: 'fresh-thread' } } })
      else send({ id: message.id, error: { message: 'unexpected fresh thread' } })
    }
    if (message.method === 'turn/start') {
      const expectedThread = fresh ? 'fresh-thread' : 'fork-thread'
      if (message.params.threadId !== expectedThread) {
        send({ id: message.id, error: { message: 'turn did not target fork' } })
      } else {
        send({ id: message.id, result: { turn: { id: 'turn-1' } } })
        send({ method: 'item/agentMessage/delta', params: { delta: 'hello ' } })
        send({ method: 'item/agentMessage/delta', params: { delta: 'studio' } })
        send({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'hello studio' } } })
        send({
          method: 'turn/completed',
          params: { turn: { status: process.env.FAKE_APP_TERMINAL || 'completed' } },
        })
      }
    }
  }
})
`,
  )
  chmodSync(file, 0o755)
  return file
}

test('forks the parent thread and streams the side answer without mutating it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-codex-app-server-'))
  roots.push(root)
  const bin = fakeCodex(root)
  const log = join(root, 'app-server.jsonl')
  const deltas: string[] = []
  const result = await runCodexForkAsk(bin, {
    root,
    prompt: 'question',
    appendSystemPrompt: 'ask protocol',
    sessionId: 'parent-thread',
    model: 'gpt-studio',
    effort: 'high',
    access: 'workspace',
    env: { FAKE_APP_LOG: log },
    signal: new AbortController().signal,
    onDelta: (delta) => deltas.push(delta),
  })

  expect(result).toEqual({ text: 'hello studio', isError: false })
  expect(deltas).toEqual(['hello ', 'studio'])
  const requests = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(requests.map((request) => request.method)).toEqual([
    'initialize',
    'initialized',
    'thread/fork',
    'turn/start',
  ])
  expect(requests[2].params).toMatchObject({
    threadId: 'parent-thread',
    cwd: root,
    approvalPolicy: 'never',
    sandbox: 'workspace-write',
    ephemeral: true,
    model: 'gpt-studio',
    config: { 'mcp_servers.domain-studio.enabled': false },
  })
  expect(requests[3].params).toMatchObject({
    threadId: 'fork-thread',
    model: 'gpt-studio',
    effort: 'high',
  })
})

test('starts a fresh Ask thread with the selected model when no parent session exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-codex-app-server-fresh-'))
  roots.push(root)
  const log = join(root, 'app-server-fresh.jsonl')
  const result = await runCodexForkAsk(fakeCodex(root), {
    root,
    prompt: 'first question',
    model: 'gpt-fresh',
    effort: 'medium',
    access: 'full',
    env: { FAKE_APP_LOG: log, FAKE_APP_EXPECT_FRESH: '1' },
    signal: new AbortController().signal,
    onDelta: () => {},
  })

  expect(result).toEqual({ text: 'hello studio', isError: false })
  const requests = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(requests.map((request) => request.method)).toEqual([
    'initialize',
    'initialized',
    'thread/start',
    'turn/start',
  ])
  expect(requests[2].params).toMatchObject({
    cwd: root,
    sandbox: 'danger-full-access',
    ephemeral: true,
    model: 'gpt-fresh',
  })
  expect(requests[3].params).toMatchObject({
    threadId: 'fresh-thread',
    model: 'gpt-fresh',
    effort: 'medium',
  })
})

test('does not report canceled app-server turns as successful answers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-codex-app-server-canceled-'))
  roots.push(root)
  const result = await runCodexForkAsk(fakeCodex(root), {
    root,
    prompt: 'question',
    sessionId: 'parent-thread',
    env: { FAKE_APP_TERMINAL: 'canceled' },
    signal: new AbortController().signal,
    onDelta: () => {},
  })

  expect(result).toEqual({
    text: 'hello studio',
    isError: true,
    errorMessage: 'Codex side question ended with status canceled',
  })
})
