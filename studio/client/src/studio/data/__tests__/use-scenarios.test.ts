import type { ScenarioStore } from '@shared/contracts/scenarios'

import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'bun:test'

import { qk } from '@/lib/api'

import { scenariosWritten } from '../use-scenarios'

const DOMAIN = 'billing'

function readerAt(revisions: Record<string, number>) {
  const queryClient = new QueryClient()
  const store: ScenarioStore = { scenarios: [], revisions }
  queryClient.setQueryData(qk.scenarios(DOMAIN), store)
  const stale = () => queryClient.getQueryState(qk.scenarios(DOMAIN))?.isInvalidated
  return { queryClient, stale }
}

test('a window that stands where a write left the Scenarios does not read them again', () => {
  const { queryClient, stale } = readerAt({ 'who-runs': 2 })
  scenariosWritten(queryClient, DOMAIN, { 'who-runs': 2 })
  expect(stale()).toBe(false)
})

test('a window another window wrote past reads the Scenarios again', () => {
  const behind = readerAt({ 'who-runs': 1 })
  scenariosWritten(behind.queryClient, DOMAIN, { 'who-runs': 2 })
  expect(behind.stale()).toBe(true)
  // one written elsewhere it had never seen, or one deleted elsewhere, too
  const added = readerAt({ 'who-runs': 2 })
  scenariosWritten(added.queryClient, DOMAIN, { 'who-runs': 2, 'who-reads': 1 })
  expect(added.stale()).toBe(true)
  const deleted = readerAt({ 'who-runs': 2 })
  scenariosWritten(deleted.queryClient, DOMAIN, {})
  expect(deleted.stale()).toBe(true)
})

test('a window that never read the Scenarios reads nothing on a write', () => {
  const queryClient = new QueryClient()
  scenariosWritten(queryClient, DOMAIN, { 'who-runs': 1 })
  expect(queryClient.getQueryState(qk.scenarios(DOMAIN))).toBeUndefined()
})
