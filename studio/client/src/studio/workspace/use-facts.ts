/**
 * What the Workspace level reads, one query per fact, so each fact loads, fails and refreshes on
 * its own and a failed registry never blanks the sources on disk.
 *
 * - Every workspace Domain's local facts, its standing and its dependencies are read at once:
 *   they are one index read per origin, which the server shares.
 * - The change report and the compatibility matrix are heavy (one platform command, one compare
 *   per Schema revision): they are read for every Domain only in a small workspace, otherwise for
 *   the Domains the reader asks about, two at a time.
 * - Every query is keyed by what the sources are now (revision, version, commit), so an edit on
 *   disk is a new question, never a stale answer.
 */

import type { DomainLocal } from '@shared/contracts/versions'
import type { DomainSummary } from '@shared/contracts/workspace'

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'

import { versionsApi, versionsKeys } from '@/lib/api'
import { answerLifetime, readAgain } from '@/lib/domain-queries'

import type { WorkspaceTarget } from './project'

import { type DomainFacts, type Fact, factOf } from './facts'

/** A workspace this small has every Domain judged at once. */
export const EAGER_JUDGE_LIMIT = 8

/** Heavy judgements running at once, across the whole Workspace level. */
export const JUDGE_SLOTS = 2

/** A queue of tasks, `slots` at a time; an urgent task goes ahead of the waiting ones. */
export function createLimiter(slots: number) {
  let running = 0
  const waiting: Array<() => void> = []
  return async function run<T>(task: () => Promise<T>, urgent = false): Promise<T> {
    if (running >= slots) {
      // a finishing task hands its slot over: `running` already counts this one when it wakes
      await new Promise<void>((resolve) =>
        urgent ? waiting.unshift(resolve) : waiting.push(resolve),
      )
    } else running += 1
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running -= 1
    }
  }
}

const judge = createLimiter(JUDGE_SLOTS)

/** What the sources are now, as far as an answer about them depends on it. */
export function sourceMark(local: DomainLocal | undefined): string {
  if (!local) return 'unread'
  const git =
    local.git === null ? 'no-git' : `${local.git.commit}${local.git.dirty ? '+dirty' : ''}`
  const dependencies = local.dependencies
    .map((entry) => `${entry.alias}=${entry.revision}`)
    .join(',')
  return [local.revision ?? 'no-revision', local.declared ?? 'no-version', git, dependencies].join(
    '|',
  )
}

/**
 * The workspace Domains whose heavy facts are read: all of them in a small workspace or when
 * asked, otherwise the selected Domain, the dependent of a selected link, and every dependent
 * of a selected Domain outside the workspace.
 */
export function judgedDomains(
  domains: readonly DomainSummary[],
  locals: readonly DomainLocal[] | undefined,
  target: WorkspaceTarget | undefined,
  everything: boolean,
): ReadonlySet<string> {
  if (everything || domains.length <= EAGER_JUDGE_LIMIT)
    return new Set(domains.map((domain) => domain.id))
  const judged = new Set<string>()
  if (target?.kind === 'domain' || target?.kind === 'dependency') judged.add(target.domainId)
  if (target?.kind === 'origin') {
    for (const local of locals ?? []) {
      if (local.dependencies.some((entry) => entry.origin === target.origin))
        judged.add(local.domainId)
    }
  }
  return judged
}

export type FactName = 'standing' | 'dependencies' | 'changes' | 'compatibility'

export interface WorkspaceFacts {
  domains: DomainFacts[]
  /** The Domains whose change report and compatibility are read. */
  judged: ReadonlySet<string>
  /** The Studio's own list of workspace sources. */
  locals: Fact<DomainLocal[]>
  /** Reads facts of one Domain again, past every cache: the registry's and the server's. */
  refresh: (domainId: string, facts?: readonly FactName[]) => Promise<void>
  /** Reads the local facts again. */
  rereadLocals: () => Promise<void>
}

const SOURCE_KEYS = new Set(['bundle', 'anatomy', 'env', 'workspace'])

/** Every fact of `domains`; the heavy ones as `judgedDomains` chooses. */
export function useWorkspaceFacts(
  domains: readonly DomainSummary[],
  target: WorkspaceTarget | undefined,
  everything: boolean,
): WorkspaceFacts {
  const queryClient = useQueryClient()
  const localsQuery = useQuery({
    queryKey: versionsKeys.locals,
    queryFn: versionsApi.locals,
    staleTime: 0,
    // edits happen in another window: coming back asks the disk again
    refetchOnWindowFocus: true,
  })

  // The Studio tells its own queries when sources change; the local facts follow them.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'invalidate') return
      const head = event.query.queryKey[0]
      if (typeof head !== 'string' || !SOURCE_KEYS.has(head)) return
      clearTimeout(timer)
      timer = setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: versionsKeys.locals }),
        300,
      )
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [queryClient])

  const localsFact = factOf(localsQuery, true)
  const localOf = useCallback(
    (domainId: string): DomainLocal | undefined =>
      localsQuery.data?.find((entry) => entry.domainId === domainId),
    [localsQuery.data],
  )
  const marks = domains.map((domain) => sourceMark(localOf(domain.id)))
  const readable = localsQuery.data !== undefined
  const judged = judgedDomains(domains, localsQuery.data, target, everything)
  // the reader's own question goes ahead of the background ones
  const urgent = (domainId: string) =>
    target !== undefined && 'domainId' in target && target.domainId === domainId

  const standing = useQueries({
    queries: domains.map((domain, index) => ({
      queryKey: [...versionsKeys.standing(domain.id), marks[index]],
      queryFn: () => versionsApi.standing(domain.id),
      enabled: readable,
      ...answerLifetime(60_000),
    })),
  })
  const dependencies = useQueries({
    queries: domains.map((domain, index) => ({
      queryKey: [...versionsKeys.dependencies(domain.id), marks[index]],
      queryFn: () => versionsApi.dependencies(domain.id),
      enabled: readable,
      ...answerLifetime(60_000),
    })),
  })
  const changes = useQueries({
    queries: domains.map((domain, index) => ({
      queryKey: [...versionsKeys.changes(domain.id), marks[index]],
      queryFn: () => judge(() => versionsApi.changes(domain.id), urgent(domain.id)),
      enabled: readable && judged.has(domain.id),
      ...answerLifetime(Number.POSITIVE_INFINITY),
      retry: false,
    })),
  })
  const compatibility = useQueries({
    queries: domains.map((domain, index) => ({
      queryKey: [...versionsKeys.compatibility(domain.id), marks[index]],
      queryFn: () => judge(() => versionsApi.compatibility(domain.id), urgent(domain.id)),
      enabled: readable && judged.has(domain.id),
      ...answerLifetime(Number.POSITIVE_INFINITY),
      retry: false,
    })),
  })

  const facts = domains.map((summary, index): DomainFacts => {
    const local = localOf(summary.id)
    const localFact: Fact<DomainLocal> =
      local !== undefined
        ? { status: 'ready', value: local, refreshing: localsQuery.isFetching }
        : localsFact.status === 'ready'
          ? { status: 'error', message: 'The Studio lists no sources for this Domain.' }
          : (localsFact as Fact<DomainLocal>)
    return {
      summary,
      local: localFact,
      standing: factOf(standing[index]!, readable),
      dependencies: factOf(dependencies[index]!, readable),
      changes: factOf(changes[index]!, readable && judged.has(summary.id)),
      compatibility: factOf(compatibility[index]!, readable && judged.has(summary.id)),
    }
  })
  // One array per answer, so the map lays out again only when something it draws changed.
  const signature = facts
    .map((fact) =>
      [
        fact.summary.id,
        fact.local,
        fact.standing,
        fact.dependencies,
        fact.changes,
        fact.compatibility,
      ]
        .map((part) => (typeof part === 'string' ? part : factSignature(part)))
        .join(':'),
    )
    .join('/')
  // biome-ignore lint/correctness/useExhaustiveDependencies: the signature stands for `facts`
  const stable = useMemo(() => facts, [signature])

  const refresh = useCallback(
    async (
      domainId: string,
      which: readonly FactName[] = ['standing', 'dependencies', 'changes', 'compatibility'],
    ) => {
      const mark = sourceMark(
        queryClient
          .getQueryData<DomainLocal[]>(versionsKeys.locals)
          ?.find((entry) => entry.domainId === domainId),
      )
      const reads: Record<FactName, () => Promise<unknown>> = {
        standing: () =>
          readAgain(queryClient, {
            queryKey: [...versionsKeys.standing(domainId), mark],
            queryFn: () => versionsApi.standing(domainId, true),
            staleTime: 0,
          }),
        dependencies: () =>
          readAgain(queryClient, {
            queryKey: [...versionsKeys.dependencies(domainId), mark],
            queryFn: () => versionsApi.dependencies(domainId, true),
            staleTime: 0,
          }),
        changes: () =>
          readAgain(queryClient, {
            queryKey: [...versionsKeys.changes(domainId), mark],
            queryFn: () => judge(() => versionsApi.changes(domainId, true), true),
            staleTime: 0,
            retry: false,
          }),
        compatibility: () =>
          readAgain(queryClient, {
            queryKey: [...versionsKeys.compatibility(domainId), mark],
            queryFn: () => judge(() => versionsApi.compatibility(domainId, true), true),
            staleTime: 0,
            retry: false,
          }),
      }
      // a failed read is shown where its fact is shown; nothing more to do with it here
      await Promise.allSettled(which.map((name) => reads[name]()))
    },
    [queryClient],
  )

  const rereadLocals = useCallback(
    () => queryClient.invalidateQueries({ queryKey: versionsKeys.locals }),
    [queryClient],
  )

  return { domains: stable, judged, locals: localsFact, refresh, rereadLocals }
}

/** A fact's identity for memoisation: its state and, once read, the answer's own object. */
const answerIds = new WeakMap<object, number>()
let nextAnswerId = 0
function factSignature(fact: Fact<unknown>): string {
  if (fact.status === 'ready') {
    const value = fact.value as object
    let id = answerIds.get(value)
    if (id === undefined) {
      id = nextAnswerId += 1
      answerIds.set(value, id)
    }
    return `ready${fact.refreshing ? '~' : ''}#${id}`
  }
  return fact.status === 'error' ? `error#${fact.message}` : fact.status
}
