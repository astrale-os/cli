/**
 * One dataset's Scenarios, as the Domain's Scenarios route keeps them. A change shows at once —
 * the Domain's Scenarios are updated in place before the server hears of it — and reaches the
 * server in the order it was made, so a delete never lands ahead of the edit made before it.
 *
 * Each write names the revision it was made from: the one this tab last saw, counting its own
 * writes before it. A write the server refuses — made from a revision another tab or a hand edit
 * has moved past, or over a file it cannot read whole — drops every write made after it in this
 * tab, reads the Scenarios back as the server keeps them, and says so.
 *
 * A write that lands, in any window, is told to every window with the revisions the Scenarios
 * now stand at (`scenariosWritten`): a window that does not stand there reads them again, once
 * its own writes have reached the server, so a read never lands between a change shown and the
 * write that makes it.
 */

import type { Scenario, ScenarioStore } from '@shared/contracts/scenarios'

import { revisionOf } from '@shared/contracts/scenarios'
import { type QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { api, isStale, qk, refusalOf, unreadableOf, type UnreadableFile } from '@/lib/api'

/** Each Domain's writes, chained so they reach the server one after another. */
const writes = new Map<string, Promise<unknown>>()
/**
 * Each Domain's count of refusals, counted when a write is refused and again once the Scenarios
 * are read back: a write made before either, from a revision the server never had, is not sent.
 */
const refusals = new Map<string, number>()
const count = (domainId: string) => refusals.get(domainId) ?? 0

function inOrder(
  domainId: string,
  write: () => Promise<unknown>,
  refused: (error: unknown) => Promise<unknown>,
) {
  const madeAt = count(domainId)
  const next = (writes.get(domainId) ?? Promise.resolve())
    .then(() => (count(domainId) === madeAt ? write() : undefined))
    .catch(async (error: unknown) => {
      refusals.set(domainId, count(domainId) + 1)
      await refused(error).catch(() => {})
      refusals.set(domainId, count(domainId) + 1)
    })
  writes.set(domainId, next)
}

/** Runs `then` once every write this tab made to the Domain's Scenarios has been answered. */
function whenSettled(domainId: string, then: () => void) {
  const chain = writes.get(domainId)
  if (!chain) return then()
  void chain.then(() => (writes.get(domainId) === chain ? then() : whenSettled(domainId, then)))
}

const sameRevisions = (
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([id, revision]) => right[id] === revision)

/**
 * A write to the Domain's Scenarios landed, in this window or another: once this tab's own
 * writes are answered, it reads them again unless it already stands at `revisions`.
 */
export function scenariosWritten(
  queryClient: QueryClient,
  domainId: string,
  revisions: Readonly<Record<string, number>>,
) {
  whenSettled(domainId, () => {
    const store = queryClient.getQueryData<ScenarioStore>(qk.scenarios(domainId))
    if (store === undefined || sameRevisions(store.revisions, revisions)) return
    void queryClient.invalidateQueries({ queryKey: qk.scenarios(domainId) })
  })
}

export const scenariosQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.scenarios(domainId),
    queryFn: () => api.scenarios(domainId),
    staleTime: Number.POSITIVE_INFINITY,
  })

const byName = (left: Scenario, right: Scenario) =>
  left.name.localeCompare(right.name) || left.id.localeCompare(right.id)

export interface DatasetScenarios {
  /** whether the Scenarios have been read (or could not be) */
  ready: boolean
  /** why they could not be read, when they could not */
  error?: string
  /** the state file, when that is why: it is left as it is and every save is refused */
  unreadable?: UnreadableFile
  /** reads the Scenarios again */
  retry: () => void
  /** the dataset's Scenarios, by name */
  scenarios: readonly Scenario[]
  /** Puts a Scenario whole: added, or in place of the one with its id. */
  put: (scenario: Scenario) => void
  /** Deletes a Scenario and returns it, to put back on undo. */
  remove: (id: string) => Scenario | undefined
  /** A Scenario as it stands now, past every change made since this render: what an undo edits. */
  get: (id: string) => Scenario | undefined
}

/** `dataset` is the dataset's module path, as Scenarios name it. */
export function useScenarios(domainId: string, dataset: string): DatasetScenarios {
  const queryClient = useQueryClient()
  const { data, isPending, error, refetch } = useQuery(scenariosQueryOptions(domainId))
  const scenarios = useMemo(
    () => (data?.scenarios ?? []).filter((one) => one.dataset === dataset).sort(byName),
    [data, dataset],
  )

  const refused = useCallback(
    (cause: unknown) => {
      const sentence = refusalOf(cause)
      if (isStale(cause))
        toast.warning('A Scenario changed elsewhere', {
          id: `scenarios-stale:${domainId}`,
          description: `${sentence} They are read again as they now stand; make the change again.`,
        })
      else
        toast.error('A Scenario could not be saved', {
          id: `scenarios-refused:${domainId}`,
          description: sentence,
        })
      return queryClient.invalidateQueries({ queryKey: qk.scenarios(domainId) })
    },
    [domainId, queryClient],
  )

  const put = useCallback(
    (scenario: Scenario) => {
      const madeFrom = revisionOf(
        queryClient.getQueryData<ScenarioStore>(qk.scenarios(domainId)),
        scenario.id,
      )
      queryClient.setQueryData<ScenarioStore>(qk.scenarios(domainId), (store) => {
        const current = store?.scenarios ?? []
        const at = current.findIndex((one) => one.id === scenario.id)
        return {
          scenarios:
            at < 0
              ? [...current, scenario]
              : current.map((one, index) => (index === at ? scenario : one)),
          // the revision the server keeps once this write lands: what the next is made from
          revisions: { ...store?.revisions, [scenario.id]: madeFrom + 1 },
        }
      })
      inOrder(domainId, () => api.putScenario(domainId, scenario, madeFrom), refused)
    },
    [domainId, queryClient, refused],
  )

  const remove = useCallback(
    (id: string) => {
      const store = queryClient.getQueryData<ScenarioStore>(qk.scenarios(domainId))
      const removed = store?.scenarios.find((one) => one.id === id)
      if (!store || !removed) return undefined
      const madeFrom = revisionOf(store, id)
      const { [id]: _gone, ...revisions } = store.revisions
      queryClient.setQueryData<ScenarioStore>(qk.scenarios(domainId), {
        scenarios: store.scenarios.filter((one) => one.id !== id),
        revisions,
      })
      inOrder(domainId, () => api.deleteScenario(domainId, id, madeFrom), refused)
      return removed
    },
    [domainId, queryClient, refused],
  )

  const get = useCallback(
    (id: string) =>
      queryClient
        .getQueryData<ScenarioStore>(qk.scenarios(domainId))
        ?.scenarios.find((one) => one.id === id),
    [domainId, queryClient],
  )

  const unreadable = unreadableOf(error)
  const retry = useCallback(() => void refetch(), [refetch])
  return {
    ready: !isPending,
    ...(error ? { error: refusalOf(error) } : {}),
    ...(unreadable ? { unreadable } : {}),
    retry,
    scenarios,
    put,
    remove,
    get,
  }
}

/** A new id for a Scenario or a step: unique enough to never meet another in one Domain. */
export function newScenarioId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return [...bytes]
    .map((byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
