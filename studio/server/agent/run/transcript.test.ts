import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/contracts/agent'
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

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-transcript-'))
  roots.push(root)
  return root
}

const chat = (): StoredChat => ({
  id: crypto.randomUUID(),
  title: 'New chat',
  harness: 'codex',
  turns: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const run = (id: string, chatId: string, extra?: Partial<AgentRun>): AgentRun => ({
  id,
  chatId,
  harness: 'codex',
  status: 'succeeded',
  createdAt: '2026-08-20T00:00:00.000Z',
  summary: id,
  targetCommentIds: [],
  events: [],
  ...extra,
})

test('a run orphaned by a restart is settled as interrupted, on disk and in memory', () => {
  const root = stateRoot()
  const tab = chat()
  writeJson(
    root,
    `last-run/${tab.id}.json`,
    run('orphan', tab.id, { status: 'running', sessionId: 'thread-1' }),
  )

  expect(readLastRun(root, tab)).toMatchObject({
    status: 'interrupted',
    sessionId: 'thread-1',
    error: expect.stringContaining('studio restarted'),
  })
  expect(readJson(root, `last-run/${tab.id}.json`, asJsonRecord, {}).status).toBe('interrupted')
  hydrateRun(root, tab)
  expect(currentRun(tab.id)).toMatchObject({ status: 'interrupted', sessionId: 'thread-1' })
  expect(readRunHistory(root, tab)).toEqual([expect.objectContaining({ id: 'orphan' })])
})

test('history is a chat’s own turns, oldest first, bounded, without prompts, and goes with it', () => {
  const root = stateRoot()
  const [tab, other] = [chat(), chat()]
  const turn = (id: string, createdAt: string, chatId = tab.id) =>
    persistRun(
      root,
      run(id, chatId, {
        createdAt,
        instruction: `Do ${id}`,
        prompt: {
          createdAt,
          systemPrompt: 'system',
          turnPrompt: 'the whole handoff markdown',
          firstTurn: true,
          resumed: false,
          mcpTools: [],
        },
      }),
      true,
    )
  turn('newer', '2026-08-20T02:00:00.000Z')
  turn('older', '2026-08-20T01:00:00.000Z')
  // another tab: a chat shows its OWN turns, never its neighbour's
  turn('sibling', '2026-08-20T04:00:00.000Z', other.id)
  mkdirSync(join(root, '.domain-studio/runs/unreadable.json'))

  expect(readRunHistory(root, tab)).toEqual([
    expect.objectContaining({ id: 'older', instruction: 'Do older' }),
    expect.objectContaining({ id: 'newer', instruction: 'Do newer' }),
  ])
  expect(readRunHistory(root, tab, 1)).toEqual([expect.objectContaining({ id: 'newer' })])
  expect(readRunHistory(root, tab, -10)).toEqual([expect.objectContaining({ id: 'newer' })])
  // the frozen prompt is the biggest field of a turn and the chat never shows it
  expect(readRunHistory(root, tab).every((entry) => entry.prompt === undefined)).toBe(true)
  // the fork summary reads the same turns, prompts and all
  expect(readChatTranscript(root, tab).map((entry) => entry.prompt?.systemPrompt)).toEqual([
    'system',
    'system',
  ])

  deleteChatRuns(root, tab)
  expect(readRunHistory(root, tab)).toEqual([])
  expect(readLastRun(root, tab)).toBeNull()
  expect(readRunHistory(root, other)).toEqual([expect.objectContaining({ id: 'sibling' })])
})

test('a persisted run admits future fields but not a malformed structure', () => {
  const root = stateRoot()
  const tab = chat()
  const last = `last-run/${tab.id}.json`
  writeJson(root, last, { ...run('finished', tab.id), futureRunField: { version: 2 } })
  expect(readLastRun(root, tab)).toMatchObject({ status: 'succeeded', summary: 'finished' })
  writeJson(root, last, { ...run('corrupt', tab.id), status: 42 })
  expect(readLastRun(root, tab)).toBeNull()
})
