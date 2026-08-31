import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/types'

import { registerDomain, unregisterDomain, type DomainHandle } from '../../domain'
import { readComments, upsertComment } from '../../state/comments'
import { updateSettings } from '../../state/settings'
import { handleBridge } from '../bridge/routes'
import { readConversation, saveConversation } from '../conversation'
import { setHarnessGateway } from '../harness/gateway/config'
import { cancelRun, getSnapshot, isRunning, setSessionId, submitRun } from './coordinator'

const roots: string[] = []
const domainIds: string[] = []
const envBefore = {
  harness: process.env.DOMAIN_STUDIO_HARNESS,
  mode: process.env.DOMAIN_STUDIO_MOCK_MODE,
  delay: process.env.DOMAIN_STUDIO_MOCK_DELAY_MS,
  model: process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL,
}

function restoreEnv(name: keyof typeof envBefore, variable: string): void {
  const value = envBefore[name]
  if (value === undefined) delete process.env[variable]
  else process.env[variable] = value
}

afterEach(() => {
  restoreEnv('harness', 'DOMAIN_STUDIO_HARNESS')
  restoreEnv('mode', 'DOMAIN_STUDIO_MOCK_MODE')
  restoreEnv('delay', 'DOMAIN_STUDIO_MOCK_DELAY_MS')
  restoreEnv('model', 'DOMAIN_STUDIO_MOCK_EXPECT_MODEL')
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixture(): DomainHandle {
  const root = mkdtempSync(join(tmpdir(), `studio-runner-${randomUUID()}-`))
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

function bridgeFiles(root: string): string[] {
  const dir = join(root, '.domain-studio', '.cache', 'agent')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((file) => file.startsWith('bridge-'))
}

async function waitForTerminal(domainId: string): Promise<AgentRun> {
  for (let i = 0; i < 200; i++) {
    const run = (await getSnapshot(domainId)).run
    if (run && !['queued', 'running'].includes(run.status)) return run
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for ${domainId}`)
}

function useMock(mode = 'normal', delay = '0'): void {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  process.env.DOMAIN_STUDIO_MOCK_MODE = mode
  process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = delay
}

describe.serial('agent runner invariants', () => {
  test('passes the selected harness model into the turn and its persisted prompt snapshot', async () => {
    useMock()
    const handle = fixture()
    process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL = 'mock-domain-model'
    updateSettings(handle.root, { agentModels: { mock: 'mock-domain-model' } })

    await submitRun(handle, () => {}, { message: 'use the selected model' })
    const run = await waitForTerminal(handle.id)

    expect(run.status).toBe('succeeded')
    expect(run.prompt?.model).toBe('mock-domain-model')
  })

  test('reserves setup synchronously and starts exactly one turn', async () => {
    useMock()
    const handle = fixture()

    const first = submitRun(handle, () => {}, { message: 'first' })
    expect(isRunning(handle.id)).toBe(true)
    expect(setSessionId(handle.id, 'hijack')).toBe(false)

    const second = await submitRun(handle, () => {}, { message: 'second' })
    expect(second).toEqual({ error: 'an agent run is already in progress for this domain' })
    expect((await first).run?.status).toBe('running')
    const completed = await waitForTerminal(handle.id)
    expect(completed.status).toBe('succeeded')
    expect(readConversation(handle.root, 'mock')).toMatchObject({
      sessionId: 'mock-session',
      turns: 1,
    })
    expect(isRunning(handle.id)).toBe(false)
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('can cancel a reserved turn before the harness launches', async () => {
    useMock()
    const handle = fixture()

    const pending = submitRun(handle, () => {}, { message: 'cancel setup' })
    expect(isRunning(handle.id)).toBe(true)
    expect(cancelRun(handle.id)).toBe(true)
    expect(await pending).toEqual({ error: 'agent run canceled during setup' })
    expect(isRunning(handle.id)).toBe(false)
    expect(readConversation(handle.root, 'mock').sessionId).toBeUndefined()
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('notification failures cannot strand a running domain lock', async () => {
    useMock()
    const handle = fixture()
    const started = await submitRun(
      handle,
      () => {
        throw new Error('listener failed')
      },
      { message: 'keep running' },
    )

    expect(started.run?.status).toBe('running')
    expect((await waitForTerminal(handle.id)).status).toBe('succeeded')
    expect(isRunning(handle.id)).toBe(false)
  })

  test('recovers a stale selected-harness session as one fresh first turn', async () => {
    useMock('resumefail')
    const handle = fixture()
    process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL = 'mock-recovery-model'
    updateSettings(handle.root, { agentModels: { mock: 'mock-recovery-model' } })
    setHarnessGateway(handle.root, {
      scope: 'domain',
      config: {
        enabled: true,
        baseUrl: 'https://gateway.invalid/v1/models/test',
        auth: { mode: 'host' },
      },
    })
    saveConversation(handle.root, 'mock', {
      sessionId: 'stale-session',
      turns: 7,
      updatedAt: 'before',
    })

    const started = await submitRun(handle, () => {}, { message: 'continue safely' })
    expect(started.run?.harness).toBe('mock')
    const run = await waitForTerminal(handle.id)

    expect(run).toMatchObject({
      status: 'succeeded',
      sessionId: 'mock-session',
      resumed: false,
    })
    expect(run.prompt).toMatchObject({
      firstTurn: true,
      resumed: false,
      sessionId: undefined,
      model: 'mock-recovery-model',
    })
    expect(run.events.map((event) => event.text)).toContain(
      'previous conversation was no longer available — started a new one',
    )
    expect(readConversation(handle.root, 'mock')).toMatchObject({
      sessionId: 'mock-session',
      turns: 1,
    })
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('does not replay a rejected resume after observable activity', async () => {
    useMock('resumefailafterevent')
    const handle = fixture()
    saveConversation(handle.root, 'mock', {
      sessionId: 'stale-session',
      turns: 2,
      updatedAt: 'before',
    })

    await submitRun(handle, () => {}, { message: 'continue once' })
    const run = await waitForTerminal(handle.id)

    expect(run).toMatchObject({
      status: 'failed',
      sessionId: undefined,
      resumed: false,
      error:
        'the previous conversation was rejected after observable activity — Studio did not retry automatically to avoid duplicating work',
    })
    expect(run.events.filter((event) => event.kind === 'tool')).toHaveLength(1)
    expect(readConversation(handle.root, 'mock').sessionId).toBeUndefined()
  })

  test('cancellation skips partial replies, preserves the session, cleans up, and permits retry', async () => {
    useMock('normal', '5000')
    const handle = fixture()
    const comment = upsertComment(handle.root, {
      anchors: ['Test'],
      anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
      text: 'keep this open if canceled',
    })
    saveConversation(handle.root, 'mock', {
      sessionId: 'stable-session',
      turns: 2,
      updatedAt: 'before',
    })

    const started = await submitRun(handle, () => {})
    expect(started.run?.status).toBe('running')
    const bridgeFile = bridgeFiles(handle.root)[0]!
    const { token } = JSON.parse(
      readFileSync(join(handle.root, '.domain-studio', '.cache', 'agent', bridgeFile), 'utf8'),
    ) as { token: string }
    expect(cancelRun(handle.id)).toBe(true)
    expect((await handleBridge(handle, 'threads', { token })).status).toBe(401)
    const canceled = await waitForTerminal(handle.id)

    expect(canceled.status).toBe('canceled')
    expect(readConversation(handle.root, 'mock')).toMatchObject({
      sessionId: 'stable-session',
      turns: 2,
    })
    expect(readComments(handle.root).comments.find((item) => item.id === comment.id)).toMatchObject(
      {
        status: 'open',
        thread: [{ role: 'user', text: 'keep this open if canceled' }],
      },
    )
    expect(bridgeFiles(handle.root)).toEqual([])
    expect(isRunning(handle.id)).toBe(false)

    process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = '0'
    const retry = await submitRun(handle, () => {}, { message: 'retry' })
    expect(retry.run?.status).toBe('running')
    expect((await waitForTerminal(handle.id)).status).toBe('succeeded')
  })

  test('harness throws and malformed final replies fail without changing the prior session', async () => {
    useMock('error')
    const handle = fixture()
    const comment = upsertComment(handle.root, {
      anchors: ['Test'],
      anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
      text: 'do not merge failed output',
    })
    saveConversation(handle.root, 'mock', {
      sessionId: 'stable-session',
      turns: 4,
      updatedAt: 'before',
    })

    await submitRun(handle, () => {})
    const thrown = await waitForTerminal(handle.id)
    expect(thrown).toMatchObject({
      status: 'failed',
      error: 'mock harness failure (test)',
    })
    expect(readConversation(handle.root, 'mock')).toMatchObject({
      sessionId: 'stable-session',
      turns: 4,
    })
    expect(
      readComments(handle.root).comments.find((item) => item.id === comment.id)?.thread,
    ).toHaveLength(1)
    expect(bridgeFiles(handle.root)).toEqual([])

    process.env.DOMAIN_STUDIO_MOCK_MODE = 'badblock'
    await submitRun(handle, () => {})
    const malformed = await waitForTerminal(handle.id)
    expect(malformed.status).toBe('failed')
    expect(malformed.error).toContain('malformed JSON')
    expect(readConversation(handle.root, 'mock')).toMatchObject({
      sessionId: 'stable-session',
      turns: 4,
    })
    expect(
      readComments(handle.root).comments.find((item) => item.id === comment.id)?.thread,
    ).toHaveLength(1)
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('dedupes an echoed live reply while still merging distinct final detail', async () => {
    useMock('liveandblockdifferent')
    const handle = fixture()
    const comment = upsertComment(handle.root, {
      anchors: ['Test'],
      anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
      text: 'answer live and in the final block',
    })
    expect(readComments(handle.root).comments.map((item) => item.id)).toEqual([comment.id])

    await submitRun(handle, () => {})
    const run = await waitForTerminal(handle.id)
    expect(run).toMatchObject({
      status: 'succeeded',
      liveReplies: 1,
      merge: { merged: 1, closed: 0 },
    })
    const saved = readComments(handle.root).comments.find((item) => item.id === comment.id)!
    expect(saved.status).toBe('closed')
    expect(saved.thread.map((entry) => `${entry.role}:${entry.text}`)).toEqual([
      'user:answer live and in the final block',
      'author:Acknowledged. (mock agent)',
      'author:Additional final detail. (mock agent)',
    ])
    expect(bridgeFiles(handle.root)).toEqual([])
  })
})
