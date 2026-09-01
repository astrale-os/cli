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
import { listState, stateExists } from '../../state/store'
import { initWorkspaceState } from '../../workspace-state'
import { handleBridge } from '../bridge/routes'
import { activeChat, recordChatTurn, resolveChat } from '../chats'
import { setHarnessGateway } from '../harness/gateway/config'
import { getHarness } from '../harness/selection'
import {
  cancelRun,
  closeChat,
  forgetChatOrigin,
  getSnapshot,
  listChats,
  openChat,
  setSessionId,
  submitRun,
  switchChatHarness,
  updateChat,
} from './coordinator'
import { isRunActive } from './live-state'
import { persistRun, readRunHistory } from './transcript'

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

async function waitForTerminal(domainId: string, chatId?: string): Promise<AgentRun> {
  for (let i = 0; i < 200; i++) {
    const run = (await getSnapshot(domainId, chatId)).run
    if (run && !['queued', 'running'].includes(run.status)) return run
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for ${domainId}`)
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** The tab every submit in these tests lands in. */
function chatId(handle: DomainHandle): string {
  return listChats(handle.id).activeId
}

function conversation(handle: DomainHandle): { sessionId?: string; turns: number } {
  const chat = activeChat(handle.root, 'mock')
  return { ...(chat.sessionId ? { sessionId: chat.sessionId } : {}), turns: chat.turns }
}

function seedConversation(handle: DomainHandle, sessionId: string, turns: number): void {
  recordChatTurn(handle.root, chatId(handle), { sessionId, turns })
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
    // Studio settings are global; point that global at this test's root.
    initWorkspaceState(handle.root)
    updateSettings(handle.root, { agentModel: { harness: 'mock', model: 'mock-domain-model' } })

    await submitRun(handle, () => {}, { message: 'use the selected model' })
    const run = await waitForTerminal(handle.id)

    expect(run.status).toBe('succeeded')
    expect(run.prompt?.model).toBe('mock-domain-model')
  })

  test('reserves setup synchronously and starts exactly one turn', async () => {
    useMock()
    const handle = fixture()

    const first = submitRun(handle, () => {}, { message: 'first' })
    expect(isRunActive(chatId(handle))).toBe(true)
    expect(setSessionId(handle.id, undefined, 'hijack')).toMatchObject({ ok: false })

    const second = await submitRun(handle, () => {}, { message: 'second' })
    expect(second).toEqual({ error: 'a turn is already running in this chat' })
    expect((await first).run?.status).toBe('running')
    const completed = await waitForTerminal(handle.id)
    expect(completed.status).toBe('succeeded')
    expect(conversation(handle)).toMatchObject({
      sessionId: 'mock-session',
      turns: 1,
    })
    expect(isRunActive(chatId(handle))).toBe(false)
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('can cancel a reserved turn before the harness launches', async () => {
    useMock()
    const handle = fixture()

    const pending = submitRun(handle, () => {}, { message: 'cancel setup' })
    expect(isRunActive(chatId(handle))).toBe(true)
    expect(cancelRun(handle.id)).toBe(true)
    expect(await pending).toEqual({ error: 'agent run canceled during setup' })
    expect(isRunActive(chatId(handle))).toBe(false)
    expect(conversation(handle).sessionId).toBeUndefined()
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
    expect(isRunActive(chatId(handle))).toBe(false)
  })

  test('recovers a stale selected-harness session as one fresh first turn', async () => {
    useMock('resumefail')
    const handle = fixture()
    process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL = 'mock-recovery-model'
    // Studio settings are global; point that global at this test's root.
    initWorkspaceState(handle.root)
    updateSettings(handle.root, { agentModel: { harness: 'mock', model: 'mock-recovery-model' } })
    setHarnessGateway(handle.root, {
      scope: 'domain',
      config: {
        enabled: true,
        baseUrl: 'https://gateway.invalid/v1/models/test',
        auth: { mode: 'host' },
      },
    })
    seedConversation(handle, 'stale-session', 7)

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
    expect(conversation(handle)).toMatchObject({
      sessionId: 'mock-session',
      turns: 1,
    })
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('does not replay a rejected resume after observable activity', async () => {
    useMock('resumefailafterevent')
    const handle = fixture()
    seedConversation(handle, 'stale-session', 2)

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
    expect(conversation(handle).sessionId).toBeUndefined()
  })

  test('cancellation skips partial replies, preserves the session, cleans up, and permits retry', async () => {
    useMock('normal', '5000')
    const handle = fixture()
    const comment = upsertComment(handle.root, {
      anchors: ['Test'],
      anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
      text: 'keep this open if canceled',
    })
    seedConversation(handle, 'stable-session', 2)

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
    expect(conversation(handle)).toMatchObject({
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
    expect(isRunActive(chatId(handle))).toBe(false)

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
    seedConversation(handle, 'stable-session', 4)

    await submitRun(handle, () => {})
    const thrown = await waitForTerminal(handle.id)
    expect(thrown).toMatchObject({
      status: 'failed',
      error: 'mock harness failure (test)',
    })
    expect(conversation(handle)).toMatchObject({
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
    expect(conversation(handle)).toMatchObject({
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

  test('several tabs run at once, each with its own session and transcript', async () => {
    useMock('normal', '150')
    const handle = fixture()
    const first = listChats(handle.id).activeId
    const second = unwrap(openChat(handle.id, { harness: 'mock' })).id

    const started = await Promise.all([
      submitRun(handle, () => {}, { message: 'in the first tab', chatId: first }),
      submitRun(handle, () => {}, { message: 'in the second tab', chatId: second }),
    ])

    // neither submit was refused: an open turn belongs to its chat, not the domain
    expect(started.map((result) => result.run?.status)).toEqual(['running', 'running'])
    expect(isRunActive(first)).toBe(true)
    expect(isRunActive(second)).toBe(true)

    expect((await waitForTerminal(handle.id, first)).status).toBe('succeeded')
    expect((await waitForTerminal(handle.id, second)).status).toBe('succeeded')

    for (const id of [first, second]) {
      expect(resolveChat(handle.root, 'mock', id)).toMatchObject({
        sessionId: 'mock-session',
        turns: 1,
      })
    }
    expect(
      readRunHistory(handle.id, handle.root, resolveChat(handle.root, 'mock', first)!),
    ).toEqual([expect.objectContaining({ instruction: 'in the first tab' })])
    expect(
      readRunHistory(handle.id, handle.root, resolveChat(handle.root, 'mock', second)!),
    ).toEqual([expect.objectContaining({ instruction: 'in the second tab' })])
  })

  test('a new tab opens on the star, or continues with the agent already open', () => {
    delete process.env.DOMAIN_STUDIO_HARNESS
    const handle = fixture()
    // nothing starred: the first tab is the agent this machine has
    expect(unwrap(openChat(handle.id, {})).harness).toBe('claude')

    // move the live conversation elsewhere and the next tab follows it — the
    // agent that was live, since nothing states where chats should start
    expect(unwrap(openChat(handle.id, { harness: 'mock' })).harness).toBe('mock')
    expect(unwrap(openChat(handle.id, {})).harness).toBe('mock')

    // starring one IS that statement, and it outranks the tab you happen to be in
    // Studio settings are global; point that global at this test's root.
    initWorkspaceState(handle.root)
    updateSettings(handle.root, { agentModel: { harness: 'claude', model: 'opus[1m]' } })
    expect(getHarness().id).toBe('claude')
    expect(unwrap(openChat(handle.id, {})).harness).toBe('claude')
  })

  test('a forked tab keeps the level the work was being thought at', async () => {
    useMock()
    const handle = fixture()
    const source = unwrap(updateChat(handle.id, listChats(handle.id).activeId, { effort: 'max' }))
    expect(source.effort).toBe('max')

    const forked = unwrap(switchChatHarness(handle.id, source.id, 'claude'))
    expect(forked).toMatchObject({ harness: 'claude', effort: 'max' })
  })

  test('switching agent forks a briefed tab and leaves the original conversation alone', async () => {
    useMock()
    const handle = fixture()
    const source = unwrap(openChat(handle.id, { harness: 'claude' }))
    recordChatTurn(handle.root, source.id, { sessionId: 'claude-session', turns: 1 })
    persistRun(
      handle.root,
      {
        id: randomUUID(),
        domainId: handle.id,
        chatId: source.id,
        harness: 'claude',
        status: 'succeeded',
        createdAt: '2026-08-20T00:00:00.000Z',
        summary: 'earlier work',
        instruction: 'Add a Subscription class',
        targetCommentIds: [],
        events: [
          {
            id: 'e1',
            ts: '2026-08-20T00:00:00.000Z',
            kind: 'message',
            text: 'Added Subscription with a renewal date.',
          },
        ],
      },
      true,
    )

    const forked = unwrap(switchChatHarness(handle.id, source.id, 'mock'))
    expect(forked).toMatchObject({
      harness: 'mock',
      turns: 0,
      origin: { chatId: source.id, harness: 'claude', pendingHandoff: true },
    })
    // the conversation it came from keeps its agent, its session and its turns
    expect(resolveChat(handle.root, 'mock', source.id)).toMatchObject({
      harness: 'claude',
      sessionId: 'claude-session',
      turns: 1,
    })
    expect(
      readRunHistory(handle.id, handle.root, resolveChat(handle.root, 'mock', source.id)!),
    ).toHaveLength(1)

    await submitRun(handle, () => {}, { message: 'carry on', chatId: forked.id })
    expect(listChats(handle.id).chats.find((chat) => chat.id === forked.id)?.origin).toMatchObject({
      pendingHandoff: false,
    })
    expect(forgetChatOrigin(handle.id, forked.id)).toEqual({
      ok: false,
      error: 'the transferred context was already sent to the agent',
    })
    const first = await waitForTerminal(handle.id, forked.id)
    expect(first.status).toBe('succeeded')
    expect(first.prompt?.turnPrompt).toContain('Transferred conversation')
    expect(first.prompt?.turnPrompt).toContain('Add a Subscription class')

    // delivered once: the next turn resumes the fork's own session instead
    await submitRun(handle, () => {}, { message: 'and again', chatId: forked.id })
    const second = await waitForTerminal(handle.id, forked.id)
    expect(second.prompt?.turnPrompt).not.toContain('Transferred conversation')
    expect(second).toMatchObject({ resumed: true, sessionId: 'mock-session' })
  })

  test('refuses to switch a chat onto the agent it already runs', () => {
    useMock()
    const handle = fixture()
    expect(switchChatHarness(handle.id, listChats(handle.id).activeId, 'mock')).toEqual({
      ok: false,
      error: 'this chat already runs mock',
    })
  })

  test('closing a tab stops its turn and its transcript never comes back', async () => {
    useMock('normal', '5000')
    const handle = fixture()
    const doomed = unwrap(openChat(handle.id, { harness: 'mock' })).id

    await submitRun(handle, () => {}, { message: 'will be closed', chatId: doomed })
    expect(isRunActive(doomed)).toBe(true)
    expect(stateExists(handle.root, `.cache/agent/last-run/${doomed}.json`)).toBe(true)

    const remaining = unwrap(closeChat(handle.id, doomed))
    expect(remaining.chats.some((chat) => chat.id === doomed)).toBe(false)
    expect(isRunActive(doomed)).toBe(false)

    // the canceled turn settles a moment later — it must not rewrite what it owned
    for (let i = 0; i < 100 && bridgeFiles(handle.root).length > 0; i++) await Bun.sleep(25)
    expect(bridgeFiles(handle.root)).toEqual([])
    expect(stateExists(handle.root, `.cache/agent/last-run/${doomed}.json`)).toBe(false)
    expect(listState(handle.root, '.cache/agent/runs')).toEqual([])
  })
})
