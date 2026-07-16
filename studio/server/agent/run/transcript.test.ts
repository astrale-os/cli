import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/types'

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
  expect(readJson<AgentRun>(root, '.cache/agent/last-run.json', running).status).toBe('interrupted')

  hydrateRun(domainId, root)
  expect(currentRun(domainId)).toMatchObject({
    status: 'interrupted',
    sessionId: 'thread-1',
  })
})
