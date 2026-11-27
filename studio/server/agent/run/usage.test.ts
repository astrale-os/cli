import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentRun } from '../../../shared/contracts/agent'

import { UnreadableState } from '../../state/state-file'
import { readState, writeJson } from '../../state/store'
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

test('records only reported usage and accumulates machine totals', () => {
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
})

test('a total not read whole is said by the read and left as it is by a run; unknown keys stay', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-usage-'))
  roots.push(root)
  writeJson(root, 'usage.json', { runs: 1, tokens: 3, costUsd: 0.5, future: { v: 2 } })
  recordRun(root, run({ tokens: 2, costUsd: 0.25 }))
  expect(JSON.parse(readState(root, 'usage.json')!)).toMatchObject({
    runs: 2,
    tokens: 5,
    costUsd: 0.75,
    future: { v: 2 },
  })

  writeJson(root, 'usage.json', { runs: -2, tokens: 'many', costUsd: 1 })
  const damaged = readState(root, 'usage.json')
  expect(() => readUsage(root)).toThrow(UnreadableState)
  expect(() => readUsage(root)).toThrow('it counts no runs')
  recordRun(root, run({ tokens: 10, costUsd: 0.25 }))
  expect(readState(root, 'usage.json')).toBe(damaged)
})
