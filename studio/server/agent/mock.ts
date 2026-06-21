/**
 * agent/mock.ts — a free, deterministic stand-in for a real harness. It exists
 * so the whole live loop (submit → stream events → edit → re-render → reply →
 * merge) can be exercised end-to-end without spending real agent credits.
 *
 * It behaves like a minimal real agent: reads the open threads, makes ONE real
 * edit to the domain schema (so the studio's watch→re-render fires), narrates a
 * few activity events, then returns a final message carrying the same
 * machine-state ```json``` reply block a real agent would emit (so the runner's
 * existing mergeReply path is exercised identically). It writes domain source
 * directly — it is standing in for the external agent actor, not the studio.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import type { Comment } from '../../shared/types'
import type { AgentHarness, AgentTurnInput, AgentTurnResult, AskInput, AskResult } from './types'

import { readComments } from '../state/comments'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}

/** A camelCase identifier derived from free text, for a synthesized prop name. */
function identFromText(text: string, fallback: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
  if (words.length === 0) return fallback
  return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('')
}

/** Insert a new optional prop into the first `props: {` block of the first
 *  non-index schema file. Returns the edited file (relative) + prop name. */
function applyMockEdit(root: string, propName: string): { file: string; prop: string } | null {
  const schemaDir = join(root, 'schema')
  if (!existsSync(schemaDir)) return null
  const files = readdirSync(schemaDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  for (const f of files) {
    const abs = join(schemaDir, f)
    const src = readFileSync(abs, 'utf8')
    const idx = src.indexOf('props: {')
    if (idx < 0) continue
    let prop = propName
    let n = 2
    while (new RegExp(`\\b${prop}\\b\\s*:`).test(src)) prop = `${propName}${n++}`
    const insertAt = idx + 'props: {'.length
    const line = `\n    /** Added by the agent in response to a studio comment. */\n    ${prop}: z.string().optional(),`
    const next = src.slice(0, insertAt) + line + src.slice(insertAt)
    writeFileSync(abs, next)
    return { file: `schema/${f}`, prop }
  }
  return null
}

export class MockHarness implements AgentHarness {
  id = 'mock'
  label = 'Mock agent (free)'

  async isAvailable(): Promise<boolean> {
    return true
  }

  async run(input: AgentTurnInput): Promise<AgentTurnResult> {
    const { root, signal, onEvent } = input
    // test knobs (env): MODE=error|noblock|openreply|badblock|resumefail, DELAY_MS=extra latency for cancel/concurrency tests
    const mode = process.env.DOMAIN_STUDIO_MOCK_MODE || 'normal'
    const extraDelay = Number(process.env.DOMAIN_STUDIO_MOCK_DELAY_MS || 0)
    // 'resumefail' rejects a RESUME (only when a sessionId is passed) so the runner's
    // auto-restart-fresh path can be exercised; the fresh retry (no sessionId) proceeds.
    if (mode === 'resumefail' && input.sessionId) {
      onEvent({ kind: 'status', text: 'resuming…' })
      return {
        sessionId: input.sessionId,
        finalText: '',
        isError: true,
        errorMessage: 'mock: no conversation found with session id',
        resumeRejected: true,
      }
    }
    const store = readComments(root)
    const open = store.comments.filter(
      (c) => c.status === 'open' && c.thread.at(-1)?.role !== 'author',
    )

    onEvent({ kind: 'status', text: 'session started' })
    await sleep(250, signal)
    if (extraDelay > 0) await sleep(extraDelay, signal)
    if (mode === 'error') throw new Error('mock harness failure (test)')
    onEvent({
      kind: 'thinking',
      text: `Reviewing ${open.length} open thread(s) and the current schema.`,
    })
    await sleep(300, signal)
    onEvent({ kind: 'tool', text: 'Read', tool: 'Read', target: '.domain-studio/comments.json' })
    await sleep(250, signal)

    // one real edit so the studio re-renders
    const seed = open[0]?.thread.at(-1)?.text ?? 'note'
    const editRes = signal.aborted ? null : applyMockEdit(root, identFromText(seed, 'agentNote'))
    if (editRes) {
      onEvent({ kind: 'tool', text: 'Edit', tool: 'Edit', target: editRes.file })
      await sleep(300, signal)
    }
    onEvent({
      kind: 'message',
      text: editRes
        ? `Added a \`${editRes.prop}\` property to \`${editRes.file}\` and answered the open threads.`
        : 'Answered the open threads.',
    })

    // final machine-state block (identical shape to a real agent reply)
    const replied: Comment[] = open.map((c) => ({
      ...c,
      status: 'closed',
      thread: [
        ...c.thread,
        {
          id: crypto.randomUUID(),
          role: 'author' as const,
          type: 'text' as const,
          text: editRes
            ? `Done — implemented this by adding \`${editRes.prop}\` to \`${editRes.file}\`. (mock agent)`
            : 'Acknowledged. (mock agent)',
        },
      ],
    }))
    const machine = {
      schemaVersion: store.schemaVersion,
      // 'openreply' leaves threads OPEN with an author entry (clarifying-question loop test)
      comments: replied.map((c) => ({
        id: c.id,
        anchors: c.anchors,
        status: mode === 'openreply' ? 'open' : c.status,
        thread: c.thread,
      })),
    }
    const finalText =
      mode === 'noblock'
        ? 'I reviewed the open threads and made the edit. (no machine-state block — resilience test)'
        : mode === 'badblock'
          ? 'I made the edit.\n\n```json\n{ this is : not valid json, ]\n```\n' // malformed-block resilience test
          : `I reviewed the open threads and made the edit.\n\n\`\`\`json\n${JSON.stringify(machine, null, 2)}\n\`\`\`\n`

    return {
      sessionId: input.sessionId ?? 'mock-session',
      finalText,
      costUsd: 0,
      numTurns: 1,
      isError: false,
    }
  }

  /** Fake streamed answer for a side-question (free plumbing test of the Ask loop). */
  async ask(input: AskInput): Promise<AskResult> {
    const forked = input.sessionId ? `(forked from ${input.sessionId.slice(0, 8)}…) ` : '(fresh) '
    const parts = [
      forked,
      'This is a mock answer to your side question. ',
      'In a real run, Haiku would answer here from the inherited conversation context.',
    ]
    let text = ''
    for (const p of parts) {
      if (input.signal.aborted) break
      text += p
      input.onDelta(p)
      await sleep(180, input.signal)
    }
    return { text, isError: false }
  }
}
