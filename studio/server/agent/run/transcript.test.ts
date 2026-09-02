import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/types'
import type { StoredChat } from '../chats'

import { asJsonRecord } from '../../json'
import { readJson, writeJson } from '../../state/store'
import { currentRun, hydrateRun } from './live-state'
import {
  deleteChatRuns,
  persistRun,
  readChatTranscript,
  readLastRun,
  readRunHistory,
} from './transcript'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function chat(extra?: Partial<StoredChat>): StoredChat {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    harness: 'codex',
    turns: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

test('reconciles a run orphaned by restart and hydrates its terminal snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-transcript-'))
  roots.push(root)
  const tab = chat()
  const running: AgentRun = {
    id: crypto.randomUUID(),
    chatId: tab.id,
    harness: 'codex',
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    summary: 'interrupted work',
    targetCommentIds: [],
    events: [],
    sessionId: 'thread-1',
  }
  writeJson(root, `last-run/${tab.id}.json`, running)

  expect(readLastRun(root, tab)).toMatchObject({
    status: 'interrupted',
    sessionId: 'thread-1',
    error: expect.stringContaining('studio restarted'),
  })
  expect(readJson(root, `last-run/${tab.id}.json`, asJsonRecord, {}).status).toBe('interrupted')

  hydrateRun(root, tab)
  expect(currentRun(tab.id)).toMatchObject({
    status: 'interrupted',
    sessionId: 'thread-1',
  })
  expect(readRunHistory(root, tab)).toEqual([
    expect.objectContaining({ id: running.id, status: 'interrupted' }),
  ])
})

test('reads bounded terminal history oldest first and skips unrelated or unreadable entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-history-'))
  roots.push(root)
  const tab = chat()
  const other = chat()
  const unrelated = chat()
  const run = (id: string, createdAt: string, chatId = tab.id): AgentRun => ({
    id,
    chatId,
    harness: 'codex',
    status: 'succeeded',
    createdAt,
    summary: id,
    instruction: `Do ${id}`,
    targetCommentIds: [],
    events: [],
    prompt: {
      createdAt,
      systemPrompt: 'system',
      turnPrompt: 'the whole handoff markdown',
      firstTurn: true,
      resumed: false,
      mcpTools: [],
    },
  })

  persistRun(root, run('newer', '2026-08-20T02:00:00.000Z'), true)
  persistRun(root, run('older', '2026-08-20T01:00:00.000Z'), true)
  persistRun(root, run('foreign', '2026-08-20T03:00:00.000Z', unrelated.id), true)
  // another tab: a chat shows its OWN turns, never its neighbour's
  persistRun(root, run('sibling', '2026-08-20T04:00:00.000Z', other.id), true)
  mkdirSync(join(root, '.domain-studio/runs/unreadable.json'))

  expect(readRunHistory(root, tab)).toEqual([
    expect.objectContaining({ id: 'older', instruction: 'Do older' }),
    expect.objectContaining({ id: 'newer', instruction: 'Do newer' }),
  ])
  expect(readRunHistory(root, other)).toEqual([expect.objectContaining({ id: 'sibling' })])
  expect(readRunHistory(root, tab, 1)).toEqual([expect.objectContaining({ id: 'newer' })])
  // the frozen prompt is the biggest field of a turn and the chat never shows it
  expect(readJson(root, 'runs/newer.json', (v) => v as AgentRun, null)?.prompt).toBeDefined()
  expect(readRunHistory(root, tab).every((turn) => turn.prompt === undefined)).toBe(true)
  expect(readRunHistory(root, tab, -10)).toEqual([expect.objectContaining({ id: 'newer' })])
  // the fork summary reads the same turns, prompts and all
  expect(readChatTranscript(root, tab).map((turn) => turn.id)).toEqual(['older', 'newer'])
})

test('closing a chat erases its transcripts and leaves the other tabs intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-delete-'))
  roots.push(root)
  const closing = chat()
  const keeping = chat()
  const run = (id: string, chatId: string): AgentRun => ({
    id,
    chatId,
    harness: 'codex',
    status: 'succeeded',
    createdAt: '2026-08-20T00:00:00.000Z',
    summary: id,
    targetCommentIds: [],
    events: [],
  })
  persistRun(root, run('doomed', closing.id), true)
  persistRun(root, run('kept', keeping.id), true)

  deleteChatRuns(root, closing)

  expect(readRunHistory(root, closing)).toEqual([])
  expect(readLastRun(root, closing)).toBeNull()
  expect(readRunHistory(root, keeping)).toEqual([expect.objectContaining({ id: 'kept' })])
})

test('admits future run fields but rejects malformed persisted run structure', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-transcript-boundary-'))
  roots.push(root)
  const tab = chat()
  writeJson(root, `last-run/${tab.id}.json`, {
    id: crypto.randomUUID(),
    chatId: tab.id,
    harness: 'codex',
    status: 'succeeded',
    createdAt: '2026-08-20T00:00:00.000Z',
    summary: 'finished work',
    targetCommentIds: [],
    events: [],
    futureRunField: { version: 2 },
  })
  expect(readLastRun(root, tab)).toMatchObject({
    status: 'succeeded',
    summary: 'finished work',
  })

  writeJson(root, `last-run/${tab.id}.json`, {
    id: crypto.randomUUID(),
    chatId: tab.id,
    harness: 'codex',
    status: 42,
    createdAt: '2026-08-20T00:00:00.000Z',
    summary: 'corrupt',
    targetCommentIds: [],
    events: [],
  })
  expect(readLastRun(root, tab)).toBeNull()
})
