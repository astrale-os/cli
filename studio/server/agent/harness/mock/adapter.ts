import { statSync } from 'node:fs'

import type { AgentToolCall, Comment } from '../../../../shared/types'
import type { AgentHarness, AgentTurnInput, AgentTurnResult, AskInput, AskResult } from '../adapter'

import { readComments } from '../../../state/comments'
import { applyMockDomainEdit } from './domain-edit'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** `DOMAIN_STUDIO_MOCK_EXPECT_MODEL` pins the model a test expects Studio to send. */
function unexpectedModel(model: string | undefined): string | undefined {
  const expected = process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL
  return expected && model !== expected
    ? `mock expected model ${expected}, received ${model ?? '(default)'}`
    : undefined
}

function authorReply(text: string) {
  return { id: crypto.randomUUID(), role: 'author' as const, type: 'text' as const, text }
}

export class MockHarness implements AgentHarness {
  id = 'mock'
  label = 'Mock agent (free)'
  capabilities = {
    effortLevels: ['low', 'medium', 'high'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: false,
    gateway: 'none',
  } as const

  async isAvailable(): Promise<boolean> {
    return true
  }

  async run(input: AgentTurnInput): Promise<AgentTurnResult> {
    const modelMismatch = unexpectedModel(input.model)
    if (modelMismatch) throw new Error(modelMismatch)
    const mode = process.env.DOMAIN_STUDIO_MOCK_MODE || 'normal'
    const extraDelay = Number(process.env.DOMAIN_STUDIO_MOCK_DELAY_MS || 0)
    if ((mode === 'resumefail' || mode === 'resumefailafterevent') && input.sessionId) {
      input.onEvent({ kind: 'status', text: 'resuming…' })
      if (mode === 'resumefailafterevent')
        input.onEvent({
          kind: 'tool',
          text: 'Edit',
          tool: 'Edit',
          target: 'schema/test.ts',
        })
      return {
        sessionId: input.sessionId,
        finalText: '',
        isError: true,
        errorMessage: 'mock: no conversation found with session id',
        resumeRejected: true,
      }
    }
    const store = readComments(input.root)
    // like a real agent, answer only the threads this turn attached — the ones it names
    const open = store.comments.filter(
      (comment) =>
        comment.status === 'open' &&
        comment.thread.at(-1)?.role !== 'author' &&
        input.prompt.includes(comment.id),
    )

    input.onEvent({ kind: 'status', text: 'session started' })
    // like a real agent, look at what was sent: an image that never arrives is the bug
    const images = (input.images ?? []).filter((image) => statSync(image.path).size > 0)
    if (images.length)
      input.onEvent({
        kind: 'status',
        text: `looked at ${images.map((image) => image.name).join(', ')}`,
      })
    await sleep(250, input.signal)
    if (extraDelay > 0) await sleep(extraDelay, input.signal)
    if (mode === 'error') throw new Error('mock harness failure (test)')
    input.onEvent({
      kind: 'thinking',
      text: `Reviewing ${open.length} open thread(s) and the current schema.`,
    })
    await sleep(300, input.signal)
    // Reported the way an ACP agent reports a call: announced with its input,
    // then again once it ran, with what it gave back - one step either way.
    const readCall = (detail: Partial<AgentToolCall>) =>
      input.onEvent({
        kind: 'tool',
        text: 'Read',
        tool: 'Read',
        target: '.domain-studio/comments.json',
        call: {
          id: 'mock-read',
          detail: {
            title: 'Read .domain-studio/comments.json',
            kind: 'read',
            input: { file_path: '.domain-studio/comments.json' },
            content: [],
            locations: ['.domain-studio/comments.json'],
            ...detail,
          },
        },
      })
    readCall({ status: 'in_progress' })
    await sleep(250, input.signal)
    readCall({
      status: 'completed',
      content: [
        {
          type: 'text',
          text: `\`\`\`json\n${JSON.stringify({ open: open.map((comment) => comment.id) }, null, 2)}\n\`\`\``,
        },
      ],
    })

    const seed = open[0]?.thread.at(-1)?.text ?? 'note'
    const edit = input.signal.aborted ? null : applyMockDomainEdit(input.root, seed)
    if (edit) {
      input.onEvent({
        kind: 'tool',
        text: 'Edit',
        tool: 'Edit',
        target: edit.file,
        call: {
          id: 'mock-edit',
          detail: {
            title: `Edit ${edit.file}`,
            kind: 'edit',
            status: 'completed',
            input: { file_path: edit.file, property: edit.prop },
            content: [
              {
                type: 'diff',
                path: edit.file,
                oldText: '  props: {',
                newText: `  props: {\n    /** Added by the agent in response to a studio comment. */\n    ${edit.prop}: z.string().optional(),`,
              },
            ],
            locations: [edit.file],
          },
        },
      })
      await sleep(300, input.signal)
    }
    input.onEvent({
      kind: 'message',
      text: edit
        ? `Added a \`${edit.prop}\` property to \`${edit.file}\` and answered the open threads.`
        : 'Answered the open threads.',
    })

    const replyText = edit
      ? `Done — implemented this by adding \`${edit.prop}\` to \`${edit.file}\`. (mock agent)`
      : 'Acknowledged. (mock agent)'

    if ((mode === 'liveandblock' || mode === 'liveandblockdifferent') && open[0]) {
      const bridge = input.mcpServers?.find((server) => server.name === 'domain-studio')
      if (!bridge?.invoke) throw new Error('mock bridge grant is not invokable')
      await bridge.invoke('reply_to_thread', {
        commentId: open[0].id,
        text: replyText,
        resolve: true,
        closeNote: 'mock live reply',
      })
    }

    const replied: Comment[] = open.map((comment) => ({
      ...comment,
      status: 'closed',
      thread: [
        ...comment.thread,
        authorReply(replyText),
        ...(mode === 'liveandblockdifferent'
          ? [authorReply('Additional final detail. (mock agent)')]
          : []),
      ],
    }))
    const machine = {
      schemaVersion: store.schemaVersion,
      comments: replied.map((comment) => ({
        id: comment.id,
        anchors: comment.anchors,
        status: mode === 'openreply' ? 'open' : comment.status,
        thread: comment.thread,
      })),
    }
    const finalText =
      mode === 'noblock'
        ? 'I reviewed the open threads and made the edit. (no machine-state block — resilience test)'
        : mode === 'badblock'
          ? 'I made the edit.\n\n```json\n{ this is : not valid json, ]\n```\n'
          : `I reviewed the open threads and made the edit.\n\n\`\`\`json\n${JSON.stringify(machine, null, 2)}\n\`\`\`\n`

    return {
      sessionId: input.sessionId ?? 'mock-session',
      finalText,
      costUsd: 0,
      numTurns: 1,
      isError: false,
    }
  }

  async ask(input: AskInput): Promise<AskResult> {
    const modelMismatch = unexpectedModel(input.model)
    if (modelMismatch) return { text: '', isError: true, errorMessage: modelMismatch }
    const expectedSession = process.env.DOMAIN_STUDIO_MOCK_EXPECT_SESSION
    if (expectedSession && input.sessionId !== expectedSession)
      return {
        text: '',
        isError: true,
        errorMessage: `mock expected session ${expectedSession}, received ${input.sessionId ?? '(fresh)'}`,
      }
    const forked = input.sessionId ? `(forked from ${input.sessionId.slice(0, 8)}…) ` : '(fresh) '
    const parts = [
      forked,
      'This is a mock answer to your side question. ',
      'In a real run, the selected harness would answer from the inherited conversation context.',
    ]
    let text = ''
    for (const part of parts) {
      if (input.signal.aborted) break
      text += part
      input.onDelta(part)
      await sleep(180, input.signal)
    }
    return { text, isError: false }
  }
}
