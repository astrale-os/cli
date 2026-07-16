import type { Comment } from '../../../../shared/types'
import type { AgentHarness, AgentTurnInput, AgentTurnResult, AskInput, AskResult } from '../adapter'

import { readComments } from '../../../state/comments'
import { applyMockDomainEdit } from './domain-edit'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
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
    const expectedModel = process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL
    if (expectedModel && input.model !== expectedModel)
      throw new Error(
        `mock expected model ${expectedModel}, received ${input.model ?? '(default)'}`,
      )
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
    const open = store.comments.filter(
      (comment) => comment.status === 'open' && comment.thread.at(-1)?.role !== 'author',
    )

    input.onEvent({ kind: 'status', text: 'session started' })
    await sleep(250, input.signal)
    if (extraDelay > 0) await sleep(extraDelay, input.signal)
    if (mode === 'error') throw new Error('mock harness failure (test)')
    input.onEvent({
      kind: 'thinking',
      text: `Reviewing ${open.length} open thread(s) and the current schema.`,
    })
    await sleep(300, input.signal)
    input.onEvent({
      kind: 'tool',
      text: 'Read',
      tool: 'Read',
      target: '.domain-studio/comments.json',
    })
    await sleep(250, input.signal)

    const seed = open[0]?.thread.at(-1)?.text ?? 'note'
    const edit = input.signal.aborted ? null : applyMockDomainEdit(input.root, seed)
    if (edit) {
      input.onEvent({ kind: 'tool', text: 'Edit', tool: 'Edit', target: edit.file })
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
        {
          id: crypto.randomUUID(),
          role: 'author' as const,
          type: 'text' as const,
          text: replyText,
        },
        ...(mode === 'liveandblockdifferent'
          ? [
              {
                id: crypto.randomUUID(),
                role: 'author' as const,
                type: 'text' as const,
                text: 'Additional final detail. (mock agent)',
              },
            ]
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
    const expectedModel = process.env.DOMAIN_STUDIO_MOCK_EXPECT_MODEL
    if (expectedModel && input.model !== expectedModel)
      return {
        text: '',
        isError: true,
        errorMessage: `mock expected model ${expectedModel}, received ${input.model ?? '(default)'}`,
      }
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
