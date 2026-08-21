import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/types'

import { asJsonRecord } from '../../json'
import { readJson, writeJson } from '../../state/store'
import { currentRun, hydrateRun } from './live-state'
import { readLastRun } from './transcript'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('reconciles a run orphaned by restart and hydrates its terminal snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-transcript-'))
  roots.push(root)
  const domainId = `domain-${crypto.randomUUID()}`
  const running: AgentRun = {
    id: crypto.randomUUID(),
    domainId,
    harness: 'codex',
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    summary: 'interrupted work',
    targetCommentIds: [],
    events: [],
    sessionId: 'thread-1',
  }
  writeJson(root, '.cache/agent/last-run.json', running)

  expect(readLastRun(domainId, root)).toMatchObject({
    status: 'interrupted',
    sessionId: 'thread-1',
    error: expect.stringContaining('studio restarted'),
  })
  expect(readJson(root, '.cache/agent/last-run.json', asJsonRecord, {}).status).toBe('interrupted')

  hydrateRun(domainId, root)
  expect(currentRun(domainId)).toMatchObject({
    status: 'interrupted',
    sessionId: 'thread-1',
  })
})

test('admits future run fields but rejects malformed persisted run structure', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-transcript-boundary-'))
  roots.push(root)
  const domainId = `domain-${crypto.randomUUID()}`
  writeJson(root, '.cache/agent/last-run.json', {
    id: crypto.randomUUID(),
    domainId,
    harness: 'codex',
    status: 'succeeded',
    createdAt: '2026-08-20T00:00:00.000Z',
    summary: 'finished work',
    targetCommentIds: [],
    events: [],
    futureRunField: { version: 2 },
  })
  expect(readLastRun(domainId, root)).toMatchObject({
    status: 'succeeded',
    summary: 'finished work',
  })

  writeJson(root, '.cache/agent/last-run.json', {
    id: crypto.randomUUID(),
    domainId,
    harness: 'codex',
    status: 42,
    createdAt: '2026-08-20T00:00:00.000Z',
    summary: 'corrupt',
    targetCommentIds: [],
    events: [],
  })
  expect(readLastRun(domainId, root)).toBeNull()
})
