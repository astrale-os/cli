import type { RemoteFailure } from '@shared/contracts/versions'

import { publicationOf } from '@shared/contracts/versions'
import {
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from '@tanstack/react-query'

import { ApiError, api, qk, versionsKeys } from './api'

/**
 * A Domain's bundle. A Publication's is a published version, which never changes: once read it
 * is kept for the page's life. One the registry could not give is asked for again when the reader
 * asks (`readPublicationAgain`), and, refused, once its refusal has stood its time.
 */
export const bundleQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.bundle(domainId),
    queryFn: () => api.bundle(domainId),
    ...(publicationOf(domainId)
      ? { ...answerLifetime(Number.POSITIVE_INFINITY), retry: false }
      : {}),
  })

/**
 * Reads a query again now. A read of it still waiting is dropped for this one, so a read that ran
 * past its limit is asked anew, not joined; the server joins its own work still running.
 */
export async function readAgain<TData, TKey extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TKey>,
): Promise<TData> {
  await queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
  return queryClient.fetchQuery(options)
}

/** Reads a Publication from the registry again, past the answer the server keeps. */
export function readPublicationAgain(queryClient: QueryClient, domainId: string): Promise<unknown> {
  return readAgain(queryClient, {
    ...bundleQueryOptions(domainId),
    queryFn: () => api.bundle(domainId, 'reader', true),
    staleTime: 0,
  }).catch(() => undefined)
}

const FAILURES: ReadonlySet<string> = new Set<RemoteFailure['status']>([
  'signed-out',
  'offline',
  'not-found',
  'refused',
  'failed',
])

/**
 * The statuses in which the registry withheld a read for a cause that ends outside the Studio:
 * the session, the network, the registry's grant. `not-found` is an answer; `failed` is a read
 * that broke, read again when the reader asks or its sources change.
 */
const REFUSALS: ReadonlySet<string> = new Set<RemoteFailure['status']>([
  'signed-out',
  'offline',
  'refused',
])

/**
 * How long a refusal stands: as long as a failed Schema bundle stands on the server
 * (`FAILED_BUNDLE_TTL_MS`). Past it, the read is asked again.
 */
export const REFUSAL_STANDS_MS = 60_000

/** Whether an answer is, or carries anywhere within it, a refusal; found once per answer. */
const refusalFound = new WeakMap<object, boolean>()
function carriesRefusal(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const known = refusalFound.get(value)
  if (known !== undefined) return known
  const record = value as Record<string, unknown>
  const found =
    (typeof record.status === 'string' &&
      REFUSALS.has(record.status) &&
      typeof record.message === 'string') ||
    Object.values(record).some(carriesRefusal)
  refusalFound.set(value, found)
  return found
}

/** Whether a query holds a refusal: its read was refused, or its answer carries one. */
export function holdsRefusal(query: { state: { data?: unknown; error?: unknown } }): boolean {
  const failure = remoteFailureOf(query.state.error)
  return (failure !== undefined && REFUSALS.has(failure.status)) || carriesRefusal(query.state.data)
}

/**
 * How long a registry-backed answer is kept: `staleTime`, and a refusal at most
 * `REFUSAL_STANDS_MS`. While a query holds a refusal, it is read again each `REFUSAL_STANDS_MS`
 * the page is shown, so a refusal never outlives its cause by more than that.
 */
export function answerLifetime(staleTime: number) {
  return {
    staleTime: (query: { state: { data?: unknown; error?: unknown } }) =>
      holdsRefusal(query) ? Math.min(staleTime, REFUSAL_STANDS_MS) : staleTime,
    refetchInterval: (query: { state: { data?: unknown; error?: unknown } }) =>
      holdsRefusal(query) ? REFUSAL_STANDS_MS : false,
  }
}

/** The registry's own answer, when a read failed because the registry did not give it. */
export function remoteFailureOf(error: unknown): RemoteFailure | undefined {
  if (!(error instanceof ApiError)) return undefined
  try {
    const body = JSON.parse(error.body) as Partial<RemoteFailure> | null
    if (body && FAILURES.has(String(body.status)) && typeof body.message === 'string')
      return body as RemoteFailure
  } catch {}
  return undefined
}

export const anatomyQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.anatomy(domainId),
    queryFn: () => api.anatomy(domainId),
  })

/** The layout is client-authoritative while an edit is in flight. */
export const layoutQueryOptions = (domainId: string) =>
  queryOptions({
    queryKey: qk.layout(domainId),
    queryFn: () => api.layout(domainId),
    staleTime: Number.POSITIVE_INFINITY,
  })

/** What the Studio derives from a Domain's sources, filed under the Domain's id. */
const DOMAIN_READS = ['bundle', 'anatomy', 'comments', 'datasets', 'env'] as const

/** Read a Domain's derived reads again: its sources changed. */
export function invalidateDomainReads(queryClient: QueryClient, domainId: string): void {
  for (const key of DOMAIN_READS) void queryClient.invalidateQueries({ queryKey: [key, domainId] })
}

/**
 * What a refresh reads again: every Domain's derived reads, the Workspace's Domains, every
 * versions and registry fact (where each Domain stands, its changes, its dependencies), whose
 * kept copies the server has just dropped too, and every Publication the registry did not give.
 * A Publication read stays: a published version does not change. The layout stays: it is the
 * reader's, not derived.
 */
export function invalidateRefreshed(queryClient: QueryClient, domainIds: readonly string[]): void {
  for (const domainId of domainIds) invalidateDomainReads(queryClient, domainId)
  for (const queryKey of [qk.workspace, versionsKeys.all, versionsKeys.registry])
    void queryClient.invalidateQueries({ queryKey })
  void queryClient.invalidateQueries({
    predicate: (query) =>
      query.state.status === 'error' &&
      query.queryKey[0] === 'bundle' &&
      typeof query.queryKey[1] === 'string' &&
      publicationOf(query.queryKey[1]) !== undefined,
  })
}
