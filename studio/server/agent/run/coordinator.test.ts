import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/contracts/agent'
import type { StudioEvent } from '../../../shared/contracts/runtime'
import type { DomainHandle } from '../../domain/registry'

import { readComments, upsertComment } from '../../state/comments'
import { studioHome } from '../../state/home'
import { updateStudioSettings } from '../../state/settings'
import { listState, stateExists, writeJson } from '../../state/store'
import { disposeTestDomains, testDomain } from '../../test-domain'
import { handleBridge } from '../bridge/routes'
import { chatQueue, MAX_QUEUED_MESSAGES, recordChatTurn, resolveChat } from '../chats'
import { getHarness } from '../harness/selection'
import { agentWorkspace } from '../workspace'
import {
  addAttachment,
  attachmentOf,
  cancelRun,
  closeChat,
  dropQueued,
  editQueued,
  forgetChatOrigin,
  getSnapshot,
  getToolCall,
  listChats,
  moveQueued,
  openChat,
  sendQueuedNow,
  setSessionId,
  submitRun,
  switchChatHarness,
  updateChat,
} from './coordinator'
import { currentRun, isRunActive, setCurrentRun } from './live-state'
import { persistRun, readRunHistory } from './transcript'

afterEach(disposeTestDomains)

const stateRoot = () => agentWorkspace().stateRoot
const active = () => listChats().activeId
const stored = (chat = active()) => resolveChat(stateRoot(), 'mock', chat)!
const queueOf = (chat?: string) => chatQueue(stored(chat)).map((message) => message.text)
const ran = (chat?: string) =>
  readRunHistory(stateRoot(), stored(chat)).map((run) => run.instruction)
const seedConversation = (sessionId: string, turns: number) =>
  recordChatTurn(stateRoot(), active(), { sessionId, turns })

function bridgeFiles(): string[] {
  if (!existsSync(stateRoot())) return []
  return readdirSync(stateRoot()).filter((file) => file.startsWith('bridge-'))
}

async function settled(chat?: string): Promise<AgentRun> {
  for (let i = 0; i < 200; i++) {
    const run = (await getSnapshot(chat)).run
    if (run && !['queued', 'running'].includes(run.status)) return run
    await Bun.sleep(25)
  }
  throw new Error('timed out waiting for the turn to settle')
}

/** Nothing running and nothing left waiting: the queue has drained itself. */
async function drained(chat = active()): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (!isRunActive(chat) && queueOf(chat).length === 0) return
    await Bun.sleep(25)
  }
  throw new Error(`timed out draining ${chat}`)
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function useMock(mode = 'normal', delay = '0'): DomainHandle {
  process.env.DOMAIN_STUDIO_HARNESS = 'mock'
  process.env.DOMAIN_STUDIO_MOCK_MODE = mode
  process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = delay
  return testDomain()
}

const comment = (handle: DomainHandle, text: string) =>
  upsertComment(handle.root, {
    anchors: ['Test'],
    anchorRefs: [{ ref: 'class.Test', kind: 'schema' }],
    text,
  })
const threadOf = (handle: DomainHandle, id: string) =>
  readComments(handle.root).comments.find((item) => item.id === id)!

/** The smallest valid PNG: one transparent pixel. */
const PIXEL = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
)

describe.serial('agent runner invariants', () => {
  test('an image goes with its message to the agent, stays in the history, and leaves with its chat', async () => {
    useMock()
    const image = unwrap(addAttachment(undefined, { name: 'mockup.png', bytes: PIXEL }))
    expect(image).toMatchObject({ name: 'mockup.png', mimeType: 'image/png', size: PIXEL.length })

    // an image alone is a message: no text needed
    const run = (await submitRun(() => {}, { attachments: [image.id] })).run!
    expect(run.attachments).toEqual([image])
    expect(run.summary).toBe('1 image')
    expect(run.prompt?.turnPrompt).toContain(attachmentOf(undefined, image.id)!.path)

    const done = await settled()
    expect(done.status).toBe('succeeded')
    // the harness was handed the bytes, not just told about them
    expect(done.events.map((event) => event.text)).toContain('looked at mockup.png')
    expect(readRunHistory(stateRoot(), stored()).at(-1)?.attachments).toEqual([image])

    const chat = active()
    unwrap(closeChat(chat))
    expect(attachmentOf(chat, image.id)).toBeUndefined()
    // an image the chat does not hold, or a file that is not one, is refused
    expect((await submitRun(() => {}, { message: 'look', attachments: [image.id] })).error).toMatch(
      /unknown image/,
    )
    expect(
      addAttachment(undefined, { name: 'notes.png', bytes: new TextEncoder().encode('hello') }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('not a PNG') })
  })

  test('a tool call is one step, its details are read on demand, and they leave with the chat', async () => {
    useMock()
    const frames: StudioEvent[] = []
    await submitRun((event) => frames.push(event), { message: 'read the threads' })
    const run = await settled()
    const chat = active()

    // announced, then settled: two reports of one call are one step, as it ended
    const reads = run.events.filter((event) => event.kind === 'tool' && event.tool === 'Read')
    expect(reads).toHaveLength(1)
    const read = reads[0]!
    expect(read).toMatchObject({ status: 'completed', revision: 2 })
    expect(
      frames.flatMap((frame) =>
        frame.type === 'agent-event' && frame.event.id === read.id ? [frame.event.status] : [],
      ),
    ).toEqual(['in_progress', 'completed'])

    // the details never ride the transcript: they are read when a step is opened
    expect(JSON.stringify(readRunHistory(stateRoot(), stored(chat)))).not.toContain('file_path')
    expect(getToolCall(chat, run.id, read.id)).toMatchObject({
      kind: 'read',
      input: { file_path: '.domain-studio/comments.json' },
    })
    // only through the chat the run belongs to, and only by the ids a run has
    expect(getToolCall(unwrap(openChat({})).id, run.id, read.id)).toBeUndefined()
    expect(getToolCall(chat, '../runs/x', read.id)).toBeUndefined()
    expect(getToolCall(chat, run.id, '__proto__')).toBeUndefined()

    unwrap(closeChat(chat))
    expect(stateExists(stateRoot(), `tool-calls/${run.id}.json`)).toBe(false)
  })

  test('Continue sends a first turn again when it stopped before any session existed', async () => {
    useMock('error')
    const failed = (await submitRun(() => {}, { message: 'build the billing domain' })).run!
    expect((await settled()).status).toBe('failed')
    expect(failed.sessionId).toBeUndefined()

    // nothing for the agent to remember: the very same message goes again
    process.env.DOMAIN_STUDIO_MOCK_MODE = 'normal'
    const resumed = await submitRun(() => {}, { resume: true })
    expect(resumed.run).toMatchObject({ instruction: 'build the billing domain', resumed: false })
    expect(resumed.run?.prompt?.turnPrompt).toContain('build the billing domain')
    expect((await settled()).status).toBe('succeeded')

    // a turn that finished leaves nothing to continue
    expect((await submitRun(() => {}, { resume: true })).error).toContain('nothing to continue')
  })

  test('Continue resumes the same session once the agent had taken the turn up', async () => {
    useMock()
    await submitRun(() => {}, { message: 'first' })
    await settled()
    await submitRun(() => {}, { message: 'second' })
    // the studio went down mid-turn, after the agent had started working
    setCurrentRun({ ...(await settled()), status: 'interrupted', error: 'the studio restarted' })

    const resumed = (await submitRun(() => {}, { resume: true })).run!
    expect(resumed).toMatchObject({ resumed: true, sessionId: 'mock-session' })
    expect(resumed.instruction).toBeUndefined()
    expect(resumed.prompt?.turnPrompt).not.toContain('second')
    await settled()
    expect(currentRun(active())?.status).toBe('succeeded')
  })

  test('the message streams in as it is written, then lands under the same id', async () => {
    useMock()
    const frames: StudioEvent[] = []
    await submitRun((event) => frames.push(event), { message: 'stream it' })
    const run = await settled()

    const message = run.events.findLast((event) => event.kind === 'message')!
    const pieces = frames.flatMap((frame) => (frame.type === 'agent-draft' ? [frame] : []))
    expect(pieces.length).toBeGreaterThan(0)
    // one draft, assembled in order, that became the message itself
    expect(new Set(pieces.map((piece) => piece.id))).toEqual(new Set([message.id]))
    let text = ''
    for (const piece of pieces) {
      expect(piece.offset).toBe(text.length)
      text += piece.text
    }
    expect(text).toBe(message.text)
    // the draft is live only; the window's occupancy rode along and stays on the run
    expect(run.draft).toBeUndefined()
    expect(frames.some((frame) => frame.type === 'agent-context')).toBe(true)
    expect(run.context).toEqual({ used: 42_000, size: 200_000 })

    // the next turn of the same conversation starts as full as this one left it
    const next = await submitRun(() => {}, { message: 'and again' })
    expect(next.run).toMatchObject({ resumed: true, context: { used: 42_000, size: 200_000 } })
    await settled()
  })

  test('open threads ride a turn only when attached, by id or all at once', async () => {
    const handle = useMock()
    const first = comment(handle, 'first question')
    const second = comment(handle, 'second question')

    // nothing attached: the message goes alone, the threads are only signalled
    const plain = (await submitRun(() => {}, { message: 'unrelated work' })).run!
    expect(plain.targetCommentIds).toEqual([])
    expect(plain.prompt?.turnPrompt).not.toContain('second question')
    await settled()

    // an empty composer with nothing attached is nothing to send
    expect((await submitRun(() => {})).error).toContain('nothing to send')

    const picked = (await submitRun(() => {}, { comments: [second.id] })).run!
    expect(picked.targetCommentIds).toEqual([second.id])
    expect(picked.prompt?.turnPrompt).toContain('second question')
    expect(picked.prompt?.turnPrompt).not.toContain('first question')
    await settled()
    expect(threadOf(handle, first.id).status).toBe('open')

    // behind a running turn, 'all' is resolved when the message is sent: a thread
    // opened while it waits does not ride along unasked
    process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = '200'
    await submitRun(() => {}, { message: 'busy' })
    const queued = (await submitRun(() => {}, { message: 'then these', comments: 'all' })).queued!
    expect(queued.comments).toContain(first.id)
    const late = comment(handle, 'opened while it waits')
    await drained()
    const last = readRunHistory(stateRoot(), stored()).at(-1)!
    expect(last.targetCommentIds).toEqual(queued.comments!)
    expect(last.targetCommentIds).not.toContain(late.id)
  })

  test('reserves setup synchronously and parks the next message behind the turn', async () => {
    useMock()
    const first = submitRun(() => {}, { message: 'first' })
    expect(isRunActive(active())).toBe(true)
    expect(setSessionId(undefined, 'hijack')).toMatchObject({ ok: false })

    // one turn at a time: the second message waits rather than racing it
    const second = await submitRun(() => {}, { message: 'second' })
    expect(second.run).toBeUndefined()
    expect(second.queued).toMatchObject({ text: 'second' })
    expect((await first).run?.status).toBe('running')

    await drained()
    expect(ran()).toEqual(['first', 'second'])
    expect(stored()).toMatchObject({ sessionId: 'mock-session', turns: 2 })
    expect(bridgeFiles()).toEqual([])
  })

  test('can cancel a reserved turn before the harness launches', async () => {
    useMock()
    const pending = submitRun(() => {}, { message: 'cancel setup' })
    expect(cancelRun()).toBe(true)
    expect(await pending).toEqual({ error: 'agent run canceled during setup' })
    expect(isRunActive(active())).toBe(false)
    expect(stored().sessionId).toBeUndefined()
    expect(bridgeFiles()).toEqual([])
  })

  test('notification failures cannot strand a running domain lock', async () => {
    useMock()
    const fail = () => {
      throw new Error('listener failed')
    }
    expect((await submitRun(fail, { message: 'keep running' })).run?.status).toBe('running')
    expect((await settled()).status).toBe('succeeded')
    expect(isRunActive(active())).toBe(false)
  })

  test('recovers a stale selected-harness session as one fresh first turn', async () => {
    useMock('resumefail')
    process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL = 'mock-recovery-model'
    updateStudioSettings({ agentModel: { harness: 'mock', model: 'mock-recovery-model' } })
    // a gateway that cannot authenticate never blocks a harness that does not use it
    writeJson(studioHome(), 'harness-gateway.json', {
      enabled: true,
      baseUrl: 'https://gateway.invalid/v1/models/test',
      auth: { mode: 'token', token: '' },
    })
    seedConversation('stale-session', 7)

    await submitRun(() => {}, { message: 'continue safely' })
    const run = await settled()
    expect(run).toMatchObject({ status: 'succeeded', sessionId: 'mock-session', resumed: false })
    expect(run.prompt).toMatchObject({ firstTurn: true, model: 'mock-recovery-model' })
    expect(run.prompt?.sessionId).toBeUndefined()
    expect(stored()).toMatchObject({ sessionId: 'mock-session', turns: 1 })
    expect(bridgeFiles()).toEqual([])
  })

  test('does not replay a rejected resume after observable activity', async () => {
    useMock('resumefailafterevent')
    seedConversation('stale-session', 2)

    await submitRun(() => {}, { message: 'continue once' })
    const run = await settled()
    expect(run).toMatchObject({ status: 'failed', resumed: false })
    expect(run.error).toContain('did not retry automatically')
    expect(run.events.filter((event) => event.kind === 'tool')).toHaveLength(1)
    expect(stored().sessionId).toBeUndefined()
  })

  test('cancellation skips partial replies, preserves the session, cleans up, and permits retry', async () => {
    const handle = useMock('normal', '5000')
    const open = comment(handle, 'keep this open if canceled')
    seedConversation('stable-session', 2)

    expect((await submitRun(() => {}, { comments: 'all' })).run?.status).toBe('running')
    const { token } = JSON.parse(readFileSync(join(stateRoot(), bridgeFiles()[0]!), 'utf8')) as {
      token: string
    }
    expect(cancelRun()).toBe(true)
    expect((await handleBridge('threads', { token })).status).toBe(401)

    expect((await settled()).status).toBe('canceled')
    expect(stored()).toMatchObject({ sessionId: 'stable-session', turns: 2 })
    expect(threadOf(handle, open.id)).toMatchObject({ status: 'open', thread: [{ role: 'user' }] })
    expect(bridgeFiles()).toEqual([])

    process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = '0'
    expect((await submitRun(() => {}, { message: 'retry' })).run?.status).toBe('running')
    expect((await settled()).status).toBe('succeeded')
  })

  test('a thrown harness or a malformed final reply fails without changing the prior session', async () => {
    const handle = useMock()
    const open = comment(handle, 'do not merge failed output')
    seedConversation('stable-session', 4)

    for (const [mode, error] of [
      ['error', 'mock harness failure (test)'],
      ['badblock', 'malformed JSON'],
    ]) {
      process.env.DOMAIN_STUDIO_MOCK_MODE = mode
      await submitRun(() => {}, { comments: 'all' })
      const run = await settled()
      expect(run.status).toBe('failed')
      expect(run.error).toContain(error)
      expect(stored()).toMatchObject({ sessionId: 'stable-session', turns: 4 })
      expect(threadOf(handle, open.id).thread).toHaveLength(1)
      expect(bridgeFiles()).toEqual([])
    }
  })

  test('dedupes an echoed live reply while still merging distinct final detail', async () => {
    const handle = useMock('liveandblockdifferent')
    const asked = comment(handle, 'answer live and in the final block')

    await submitRun(() => {}, { comments: 'all' })
    expect(await settled()).toMatchObject({
      status: 'succeeded',
      liveReplies: 1,
      merge: { merged: 1, closed: 0 },
    })
    const saved = threadOf(handle, asked.id)
    expect(saved.status).toBe('closed')
    expect(saved.thread.map((entry) => `${entry.role}:${entry.text}`)).toEqual([
      'user:answer live and in the final block',
      'author:Acknowledged. (mock agent)',
      'author:Additional final detail. (mock agent)',
    ])
  })

  test('several tabs run at once, each with its own session and transcript', async () => {
    useMock('normal', '150')
    const tabs = [active(), unwrap(openChat({ harness: 'mock' })).id]
    const started = await Promise.all(
      tabs.map((chatId) => submitRun(() => {}, { message: `in ${chatId}`, chatId })),
    )

    // neither submit was refused: an open turn belongs to its chat, not the domain
    expect(started.map((result) => result.run?.status)).toEqual(['running', 'running'])
    for (const chat of tabs) {
      expect((await settled(chat)).status).toBe('succeeded')
      expect(stored(chat)).toMatchObject({ sessionId: 'mock-session', turns: 1 })
      expect(ran(chat)).toEqual([`in ${chat}`])
    }
  })

  test('a new tab continues the tab in front of you: agent, model, effort and speed', () => {
    delete process.env.DOMAIN_STUDIO_HARNESS
    testDomain()
    // nothing starred: the first tab is the agent this machine has
    expect(unwrap(openChat({})).harness).toBe('claude')

    // move the live conversation elsewhere and the next tab follows it
    expect(unwrap(openChat({ harness: 'mock' })).harness).toBe('mock')
    unwrap(updateChat(active(), { model: 'mock-large', effort: 'high', fastMode: true }))
    expect(unwrap(openChat({}))).toMatchObject({
      harness: 'mock',
      model: 'mock-large',
      effort: 'high',
      fastMode: true,
    })

    // a star does not pull a new tab away from the work in front of you
    updateStudioSettings({ agentModel: { harness: 'claude', model: 'opus[1m]' } })
    expect(getHarness().id).toBe('claude')
    expect(unwrap(openChat({}))).toMatchObject({ harness: 'mock', model: 'mock-large' })

    // asking for another agent keeps the effort and speed, never the other agent's model
    const other = unwrap(openChat({ harness: 'claude' }))
    expect(other).toMatchObject({ harness: 'claude', effort: 'high', fastMode: true })
    expect(other.model).toBeUndefined()
  })

  test('a chat opened for a fresh domain carries its exact target into the first prompt', async () => {
    const handle = useMock()
    const chat = unwrap(openChat({ harness: 'mock', newDomainId: handle.id }))
    expect(chat.newDomain).toEqual({ id: handle.id, origin: handle.origin ?? handle.id, path: '.' })

    await submitRun(() => {}, { chatId: chat.id, message: 'Model invoices and payments.' })
    const run = await settled(chat.id)
    expect(run.prompt?.turnPrompt).toContain(`\`${chat.newDomain?.origin}\``)
    expect(stored(chat.id).newDomain).toEqual(chat.newDomain)
  })

  test('switching agent forks a briefed tab and leaves the original conversation alone', async () => {
    useMock()
    const source = unwrap(openChat({ harness: 'claude' }))
    unwrap(updateChat(source.id, { effort: 'max' }))
    expect(switchChatHarness(source.id, 'claude')).toMatchObject({ ok: false })
    recordChatTurn(stateRoot(), source.id, { sessionId: 'claude-session', turns: 1 })
    const at = '2026-08-20T00:00:00.000Z'
    persistRun(
      stateRoot(),
      {
        id: 'earlier',
        chatId: source.id,
        harness: 'claude',
        status: 'succeeded',
        createdAt: at,
        summary: 'earlier work',
        instruction: 'Add a Subscription class',
        targetCommentIds: [],
        events: [{ id: 'e1', ts: at, kind: 'message', text: 'Added Subscription.' }],
      },
      true,
    )

    const forked = unwrap(switchChatHarness(source.id, 'mock'))
    expect(forked).toMatchObject({
      harness: 'mock',
      // how hard the work was being thought about follows it to the other agent
      effort: 'max',
      turns: 0,
      origin: { chatId: source.id, harness: 'claude', pendingHandoff: true },
    })
    // the conversation it came from keeps its agent, its session and its turns
    expect(stored(source.id)).toMatchObject({
      harness: 'claude',
      sessionId: 'claude-session',
      turns: 1,
    })
    expect(ran(source.id)).toHaveLength(1)

    await submitRun(() => {}, { message: 'carry on', chatId: forked.id })
    expect(forgetChatOrigin(forked.id)).toEqual({
      ok: false,
      error: 'the transferred context was already sent to the agent',
    })
    expect((await settled(forked.id)).prompt?.turnPrompt).toContain('Add a Subscription class')

    // delivered once: the next turn resumes the fork's own session instead
    await submitRun(() => {}, { message: 'and again', chatId: forked.id })
    const second = await settled(forked.id)
    expect(second.prompt?.turnPrompt).not.toContain('Add a Subscription class')
    expect(second).toMatchObject({ resumed: true, sessionId: 'mock-session' })
  })

  test('closing a tab stops its turn and its transcript never comes back', async () => {
    useMock('normal', '5000')
    const doomed = unwrap(openChat({ harness: 'mock' })).id
    await submitRun(() => {}, { message: 'will be closed', chatId: doomed })
    expect(stateExists(stateRoot(), `last-run/${doomed}.json`)).toBe(true)

    expect(unwrap(closeChat(doomed)).chats.some((chat) => chat.id === doomed)).toBe(false)
    expect(isRunActive(doomed)).toBe(false)

    // the canceled turn settles a moment later: it must not rewrite what it owned
    for (let i = 0; i < 100 && bridgeFiles().length > 0; i++) await Bun.sleep(25)
    expect(bridgeFiles()).toEqual([])
    expect(stateExists(stateRoot(), `last-run/${doomed}.json`)).toBe(false)
    expect(listState(stateRoot(), 'runs')).toEqual([])
  })

  test('a stopped turn holds the queue instead of sending it on', async () => {
    useMock('normal', '5000')
    await submitRun(() => {}, { message: 'the long one' })
    expect((await submitRun(() => {}, { message: 'wait for me' })).queued).toBeDefined()
    expect(cancelRun()).toBe(true)
    expect((await settled()).status).toBe('canceled')

    // stopping is how you take the wheel back: the queue is still yours to send
    await Bun.sleep(150)
    expect(queueOf()).toEqual(['wait for me'])
    expect(isRunActive(active())).toBe(false)
  })

  test('sending a queued message now stops the turn in progress and jumps the line', async () => {
    useMock('normal', '5000')
    await submitRun(() => {}, { message: 'going the wrong way' })
    await submitRun(() => {}, { message: 'second' })
    const third = (await submitRun(() => {}, { message: 'third' })).queued!

    process.env.DOMAIN_STUDIO_MOCK_DELAY_MS = '0'
    const promoted = unwrap(await sendQueuedNow(() => {}, undefined, third.id))
    expect(promoted.run).toMatchObject({ status: 'running', instruction: 'third' })
    // promoting the same message twice is refused BEFORE anything is stopped
    expect(await sendQueuedNow(() => {}, undefined, third.id)).toMatchObject({ ok: false })
    expect(isRunActive(active())).toBe(true)

    await drained()
    expect(ran()).toEqual(['going the wrong way', 'third', 'second'])
  })

  test('a waiting message can be reordered, rewritten or dropped, and the queue is bounded', async () => {
    useMock('normal', '5000')
    const chat = active()
    const texts = (result: ReturnType<typeof moveQueued>) =>
      unwrap(result).queued.map((message) => message.text)

    await submitRun(() => {}, { message: 'running' })
    const [one, two, three] = [
      (await submitRun(() => {}, { message: 'one' })).queued!,
      (await submitRun(() => {}, { message: 'two' })).queued!,
      (await submitRun(() => {}, { message: 'three' })).queued!,
    ]
    expect(texts(moveQueued(chat, three.id, 'up'))).toEqual(['one', 'three', 'two'])
    expect(moveQueued(chat, one.id, 'up')).toMatchObject({ ok: false })
    expect(texts(editQueued(chat, two.id, '  two, revised  '))).toEqual([
      'one',
      'three',
      'two, revised',
    ])
    expect(editQueued(chat, two.id, '   ')).toMatchObject({ ok: false })
    expect(texts(dropQueued(chat, one.id))).toEqual(['three', 'two, revised'])
    expect(dropQueued(chat, one.id)).toMatchObject({ ok: false })

    while (queueOf().length < MAX_QUEUED_MESSAGES)
      expect((await submitRun(() => {}, { message: 'more' })).queued).toBeDefined()
    expect(await submitRun(() => {}, { message: 'one too many' })).toEqual({
      error: `the queue is full — ${MAX_QUEUED_MESSAGES} messages already wait here`,
    })
    // a bare resume never queues: there is no message to hold on to
    expect(await submitRun(() => {}, { resume: true })).toEqual({
      error: 'a turn is already running in this chat',
    })

    expect(cancelRun()).toBe(true)
    await settled()
  })
})
