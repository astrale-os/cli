import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/contracts/agent'

import { writeJson } from '../../state/store'
import { readUsage, recordRun } from './usage'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function run(values: Partial<AgentRun>): AgentRun {
  return {
    id: crypto.randomUUID(),
    chatId: 'chat',
    harness: 'mock',
    status: 'succeeded',
    createdAt: new Date().toISOString(),
    summary: 'test',
    targetCommentIds: [],
    events: [],
    ...values,
  }
}

test('records only reported usage, accumulates machine totals, and reads a damaged file as none', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-usage-'))
  roots.push(root)
  recordRun(root, run({}))
  expect(readUsage(root)).toEqual({ runs: 0, tokens: 0, costUsd: 0 })

  recordRun(root, run({ tokens: 10, costUsd: 0.25, finishedAt: '2026-01-01T00:00:00.000Z' }))
  recordRun(root, run({ tokens: 5, costUsd: 0.1, finishedAt: '2026-01-02T00:00:00.000Z' }))
  expect(readUsage(root)).toMatchObject({
    runs: 2,
    tokens: 15,
    costUsd: 0.35,
    lastRunAt: '2026-01-02T00:00:00.000Z',
    lastTokens: 5,
    lastCostUsd: 0.1,
  })

  // malformed fields read as nothing; a field from a later release is ignored
  writeJson(root, 'usage.json', { runs: -2, tokens: 'many', lastRunAt: 42, future: { v: 2 } })
  expect(readUsage(root)).toEqual({ runs: 0, tokens: 0, costUsd: 0 })
})
