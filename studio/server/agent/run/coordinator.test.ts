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
import { settingsRoot } from '../../studio-settings'
import { initWorkspaceState } from '../../workspace-state'
import { handleBridge } from '../bridge/routes'
import { activeChat, chatQueue, MAX_QUEUED_MESSAGES, recordChatTurn, resolveChat } from '../chats'
import { setHarnessGateway } from '../harness/gateway/config'
import { getHarness } from '../harness/selection'
import { agentWorkspace } from '../workspace'
import {
  cancelRun,
  closeChat,
  dropQueued,
  editQueued,
  forgetChatOrigin,
  getSnapshot,
  listChats,
  moveQueued,
  openChat,
  sendQueuedNow,
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
  astraleHome: process.env.ASTRALE_HOME,
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
  restoreEnv('astraleHome', 'ASTRALE_HOME')
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
  process.env.ASTRALE_HOME = join(root, '.astrale')
  initWorkspaceState(root)
  return handle
}

function bridgeFiles(_root: string): string[] {
  const root = agentWorkspace().stateRoot
  if (!existsSync(root)) return []
  return readdirSync(root).filter((file) => file.startsWith('bridge-'))
}

async function waitForTerminal(_domainId: string, chatId?: string): Promise<AgentRun> {
  for (let i = 0; i < 200; i++) {
    const run = (await getSnapshot(chatId)).run
    if (run && !['queued', 'running'].includes(run.status)) return run
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for ${_domainId}`)
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** The tab every submit in these tests lands in. */
function chatId(_handle: DomainHandle): string {
  return listChats().activeId
}

/** The messages still waiting behind a chat's turn, oldest first. */
function queueOf(handle: DomainHandle, chat?: string): string[] {
  const stored = resolveChat(agentWorkspace().stateRoot, 'mock', chat ?? chatId(handle))
  return chatQueue(stored!).map((message) => message.text)
}

/** Nothing running and nothing left waiting — the queue has drained itself. */
async function waitForDrained(handle: DomainHandle, chat?: string): Promise<void> {
  const id = chat ?? chatId(handle)
  for (let i = 0; i < 400; i++) {
    if (!isRunActive(id) && queueOf(handle, id).length === 0) return
    await Bun.sleep(25)
  }
  throw new Error(`timed out draining ${id}`)
}

/** What this chat actually ran, in order. */
function ranMessages(handle: DomainHandle, chat?: string): (string | undefined)[] {
  const root = agentWorkspace().stateRoot
  const stored = resolveChat(root, 'mock', chat ?? chatId(handle))!
  return readRunHistory(root, stored).map((run) => run.instruction)
}

function conversation(_handle: DomainHandle): { sessionId?: string; turns: number } {
  const workspace = agentWorkspace()
  const chat = activeChat(workspace.stateRoot, 'mock', undefined, workspace.uiRoot)
  return { ...(chat.sessionId ? { sessionId: chat.sessionId } : {}), turns: chat.turns }
}

function seedConversation(handle: DomainHandle, sessionId: string, turns: number): void {
  recordChatTurn(agentWorkspace().stateRoot, chatId(handle), { sessionId, turns })
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
    updateSettings(settingsRoot(), { agentModel: { harness: 'mock', model: 'mock-domain-model' } })

    await submitRun(() => {}, { message: 'use the selected model' })
    const run = await waitForTerminal(handle.id)

    expect(run.status).toBe('succeeded')
    expect(run.prompt?.model).toBe('mock-domain-model')
  })

  test('reserves setup synchronously and parks the next message behind the turn', async () => {
    useMock()
    const handle = fixture()

    const first = submitRun(() => {}, { message: 'first' })
    expect(isRunActive(chatId(handle))).toBe(true)
    expect(setSessionId(undefined, 'hijack')).toMatchObject({ ok: false })

    // one turn at a time is the invariant — the second message waits rather than
    // racing it, and nothing about the running turn changes
    const second = await submitRun(() => {}, { message: 'second' })
    expect(second.run).toBeUndefined()
    expect(second.queued).toMatchObject({ text: 'second' })
    expect((await first).run?.status).toBe('running')
    expect(queueOf(handle)).toEqual(['second'])

    await waitForDrained(handle)
    expect(ranMessages(handle)).toEqual(['first', 'second'])
    expect(conversation(handle)).toMatchObject({ sessionId: 'mock-session', turns: 2 })
    expect(isRunActive(chatId(handle))).toBe(false)
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('can cancel a reserved turn before the harness launches', async () => {
    useMock()
    const handle = fixture()

    const pending = submitRun(() => {}, { message: 'cancel setup' })
    expect(isRunActive(chatId(handle))).toBe(true)
    expect(cancelRun()).toBe(true)
    expect(await pending).toEqual({ error: 'agent run canceled during setup' })
    expect(isRunActive(chatId(handle))).toBe(false)
    expect(conversation(handle).sessionId).toBeUndefined()
    expect(bridgeFiles(handle.root)).toEqual([])
  })

  test('notification failures cannot strand a running domain lock', async () => {
    useMock()
    const handle = fixture()
    const started = await submitRun(
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
    updateSettings(settingsRoot(), {
      agentModel: { harness: 'mock', model: 'mock-recovery-model' },
    })
    setHarnessGateway({
      enabled: true,
      baseUrl: 'https://gateway.invalid/v1/models/test',
      auth: { mode: 'host' },
    })
    seedConversation(handle, 'stale-session', 7)

    const started = await submitRun(() => {}, { message: 'continue safely' })
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

    await submitRun(() => {}, { message: 'continue once' })
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

    const started = await submitRun(() => {})
    expect(started.run?.status).toBe('running')
    const bridgeFile = bridgeFiles(handle.root)[0]!
    const { token } = JSON.parse(
      readFileSync(join(agentWorkspace().stateRoot, bridgeFile), 'utf8'),
    ) as { token: string }
    expect(cancelRun()).toBe(true)
    expect((await handleBridge('threads', { token })).status).toBe(401)
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
    const retry = await submitRun(() => {}, { message: 'retry' })
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

    await submitRun(() => {})
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
    await submitRun(() => {})
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

    await submitRun(() => {})
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
    const first = listChats().activeId
    const second = unwrap(openChat({ harness: 'mock' })).id

    const started = await Promise.all([
      submitRun(() => {}, { message: 'in the first tab', chatId: first }),
      submitRun(() => {}, { message: 'in the second tab', chatId: second }),
    ])

    // neither submit was refused: an open turn belongs to its chat, not the domain
    expect(started.map((result) => result.run?.status)).toEqual(['running', 'running'])
    expect(isRunActive(first)).toBe(true)
    expect(isRunActive(second)).toBe(true)

    expect((await waitForTerminal(handle.id, first)).status).toBe('succeeded')
    expect((await waitForTerminal(handle.id, second)).status).toBe('succeeded')

    for (const id of [first, second]) {
      expect(resolveChat(agentWorkspace().stateRoot, 'mock', id)).toMatchObject({
        sessionId: 'mock-session',
        turns: 1,
      })
    }
    expect(
      readRunHistory(
        agentWorkspace().stateRoot,
        resolveChat(agentWorkspace().stateRoot, 'mock', first)!,
      ),
    ).toEqual([expect.objectContaining({ instruction: 'in the first tab' })])
    expect(
      readRunHistory(
        agentWorkspace().stateRoot,
        resolveChat(agentWorkspace().stateRoot, 'mock', second)!,
      ),
    ).toEqual([expect.objectContaining({ instruction: 'in the second tab' })])
  })

  test('a new tab opens on the star, or continues with the agent already open', () => {
    delete process.env.DOMAIN_STUDIO_HARNESS
    const handle = fixture()
    // nothing starred: the first tab is the agent this machine has
    expect(unwrap(openChat({})).harness).toBe('claude')

    // move the live conversation elsewhere and the next tab follows it — the
    // agent that was live, since nothing states where chats should start
    expect(unwrap(openChat({ harness: 'mock' })).harness).toBe('mock')
    expect(unwrap(openChat({})).harness).toBe('mock')

    // starring one IS that statement, and it outranks the tab you happen to be in
    // Studio settings are global; point that global at this test's root.
    initWorkspaceState(handle.root)
    updateSettings(settingsRoot(), { agentModel: { harness: 'claude', model: 'opus[1m]' } })
    expect(getHarness().id).toBe('claude')
    expect(unwrap(openChat({})).harness).toBe('claude')
  })

  test('a chat opened for a fresh domain carries its exact target into the first prompt', async () => {
    useMock()
    const handle = fixture()
    const workspace = agentWorkspace()
    const chat = unwrap(openChat({ harness: 'mock', newDomainId: handle.id }))

    expect(chat.newDomain).toEqual({
      id: handle.id,
      origin: handle.origin ?? handle.id,
      path: '.',
    })

    await submitRun(() => {}, { chatId: chat.id, message: 'Model invoices and payments.' })
    const run = await waitForTerminal(handle.id, chat.id)

    expect(run.prompt?.turnPrompt).toContain('## Newly created domain')
    expect(run.prompt?.turnPrompt).toContain(`**Origin:** \`${chat.newDomain?.origin}\``)
    expect(run.prompt?.turnPrompt).toContain(`**Repo:** \`${chat.newDomain?.path}\``)
    expect(run.prompt?.turnPrompt).toContain('## User creation brief')
    expect(resolveChat(workspace.stateRoot, 'mock', chat.id)?.newDomain).toEqual(chat.newDomain)
  })

  test('a forked tab keeps the level the work was being thought at', async () => {
    useMock()
    fixture()
    const source = unwrap(updateChat(listChats().activeId, { effort: 'max' }))
    expect(source.effort).toBe('max')

    const forked = unwrap(switchChatHarness(source.id, 'claude'))
    expect(forked).toMatchObject({ harness: 'claude', effort: 'max' })
  })

  test('switching agent forks a briefed tab and leaves the original conversation alone', async () => {
    useMock()
    const handle = fixture()
    const source = unwrap(openChat({ harness: 'claude' }))
    recordChatTurn(agentWorkspace().stateRoot, source.id, {
      sessionId: 'claude-session',
      turns: 1,
    })
    persistRun(
      agentWorkspace().stateRoot,
      {
        id: randomUUID(),
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

    const forked = unwrap(switchChatHarness(source.id, 'mock'))
    expect(forked).toMatchObject({
      harness: 'mock',
      turns: 0,
      origin: { chatId: source.id, harness: 'claude', pendingHandoff: true },
    })
    // the conversation it came from keeps its agent, its session and its turns
    expect(resolveChat(agentWorkspace().stateRoot, 'mock', source.id)).toMatchObject({
      harness: 'claude',
      sessionId: 'claude-session',
      turns: 1,
    })
    expect(
      readRunHistory(
        agentWorkspace().stateRoot,
        resolveChat(agentWorkspace().stateRoot, 'mock', source.id)!,
      ),
    ).toHaveLength(1)

    await submitRun(() => {}, { message: 'carry on', chatId: forked.id })
    expect(listChats().chats.find((chat) => chat.id === forked.id)?.origin).toMatchObject({
      pendingHandoff: false,
    })
    expect(forgetChatOrigin(forked.id)).toEqual({
      ok: false,
      error: 'the transferred context was already sent to the agent',
    })
    const first = await waitForTerminal(handle.id, forked.id)
    expect(first.status).toBe('succeeded')
    expect(first.prompt?.turnPrompt).toContain('Transferred conversation')
    expect(first.prompt?.turnPrompt).toContain('Add a Subscription class')

    // delivered once: the next turn resumes the fork's own session instead
    await submitRun(() => {}, { message: 'and again', chatId: forked.id })
    const second = await waitForTerminal(handle.id, forked.id)
    expect(second.prompt?.turnPrompt).not.toContain('Transferred conversation')
    expect(second).toMatchObject({ resumed: true, sessionId: 'mock-session' })
  })

  test('refuses to switch a chat onto the agent it already runs', () => {
    useMock()
    fixture()
    expect(switchChatHarness(listChats().activeId, 'mock')).toEqual({
      ok: false,
      error: 'this chat already runs mock',
    })
  })

  test('closing a tab stops its turn and its transcript never comes back', async () => {
    useMock('normal', '5000')
    const handle = fixture()
    const doomed = unwrap(openChat({ harness: 'mock' })).id

    await submitRun(() => {}, { message: 'will be closed', chatId: doomed })
    expect(isRunActive(doomed)).toBe(true)
    expect(stateExists(agentWorkspace().stateRoot, `last-run/${doomed}.json`)).toBe(true)

    const remaining = unwrap(closeChat(doomed))
    expect(remaining.chats.some((chat) => chat.id === doomed)).toBe(false)
    expect(isRunActive(doomed)).toBe(false)

    // the canceled turn settles a moment later — it must not rewrite what it owned
    for (let i = 0; i < 100 && bridgeFiles(handle.root).length > 0; i++) await Bun.sleep(25)
    expect(bridgeFiles(handle.root)).toEqual([])
    expect(stateExists(agentWorkspace().stateRoot, `last-run/${doomed}.json`)).toBe(false)
    expect(listState(agentWorkspace().stateRoot, 'runs')).toEqual([])
  })
  test('a stopped turn holds the queue instead of sending it on', async () => {
    useMock('normal', '5000')
    const handle = fixture()

    await submitRun(() => {}, { message: 'the long one' })
    expect((await submitRun(() => {}, { message: 'wait for me' })).queued).toBeDefined()
    expect(cancelRun()).toBe(true)
    expect((await waitForTerminal(handle.id)).status).toBe('canceled')

    // stopping is how you take the wheel back: the queue is still yours to send
    await Bun.sleep(150)
    expect(queueOf(handle)).toEqual(['wait for me'])
    expect(isRunActive(chatId(handle))).toBe(false)
    expect(conversation(handle).turns).toBe(0)
  })

  test('sending a queued message now stops the turn in progress and jumps the line', async () => {
    useMock('normal', '5000')
    const handle = fixture()

    await submitRun(() => {}, { message: 'going the wrong way' })
    await submitRun(() => {}, { message: 'second' })
    const third = (await submitRun(() => {}, { message: 'third' })).queued!
    expect(queueOf(handle)).toEqual(['second', 'third'])

    process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = '0'
    const promoted = unwrap(await sendQueuedNow(() => {}, undefined, third.id))
    expect(promoted.run).toMatchObject({ status: 'running', instruction: 'third' })
    // promoting the same message twice is refused BEFORE anything is stopped —
    // the turn it just started keeps running
    expect(await sendQueuedNow(() => {}, undefined, third.id)).toMatchObject({ ok: false })
    expect(isRunActive(chatId(handle))).toBe(true)

    await waitForDrained(handle)
    // the interrupted turn is history, the promoted one ran in its place, and the
    // rest of the queue picked up again behind it
    expect(ranMessages(handle)).toEqual(['going the wrong way', 'third', 'second'])
  })

  test('a waiting message can be reordered, rewritten or dropped before it runs', async () => {
    useMock('normal', '5000')
    const handle = fixture()
    const chat = chatId(handle)
    const texts = (result: ReturnType<typeof moveQueued>) =>
      unwrap(result).queued.map((message) => message.text)

    await submitRun(() => {}, { message: 'running' })
    const one = (await submitRun(() => {}, { message: 'one' })).queued!
    const two = (await submitRun(() => {}, { message: 'two' })).queued!
    const three = (await submitRun(() => {}, { message: 'three' })).queued!

    expect(texts(moveQueued(chat, three.id, 'up'))).toEqual(['one', 'three', 'two'])
    // the front of the queue has nowhere earlier to go, and says so
    expect(moveQueued(chat, one.id, 'up')).toMatchObject({ ok: false })
    expect(texts(editQueued(chat, two.id, '  two, revised  '))).toEqual([
      'one',
      'three',
      'two, revised',
    ])
    expect(editQueued(chat, two.id, '   ')).toMatchObject({ ok: false })
    expect(texts(dropQueued(chat, one.id))).toEqual(['three', 'two, revised'])
    expect(dropQueued(chat, one.id)).toMatchObject({ ok: false })

    expect(cancelRun()).toBe(true)
    await waitForTerminal(handle.id)
  })

  test('the queue is bounded, and refuses rather than growing', async () => {
    useMock('normal', '5000')
    const handle = fixture()

    await submitRun(() => {}, { message: 'running' })
    for (let i = 0; i < MAX_QUEUED_MESSAGES; i++)
      expect((await submitRun(() => {}, { message: `queued ${i}` })).queued).toBeDefined()
    expect(await submitRun(() => {}, { message: 'one too many' })).toEqual({
      error: `the queue is full — ${MAX_QUEUED_MESSAGES} messages already wait here`,
    })
    // a bare resume never queues: there is no message to hold on to
    expect(await submitRun(() => {}, { resume: true })).toEqual({
      error: 'a turn is already running in this chat',
    })

    expect(cancelRun()).toBe(true)
    await waitForTerminal(handle.id)
  })
})
