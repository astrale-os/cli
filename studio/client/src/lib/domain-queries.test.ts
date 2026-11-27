import { publishedDomainId, type RemoteFailure } from '@shared/contracts/versions'
import { QueryClient } from '@tanstack/react-query'
import { expect, setSystemTime, test } from 'bun:test'

import { ApiError, qk, versionsKeys } from './api'
import {
  REFUSAL_STANDS_MS,
  answerLifetime,
  bundleQueryOptions,
  invalidateDomainReads,
  invalidateRefreshed,
  readAgain,
  remoteFailureOf,
} from './domain-queries'

const ID = 'issues'
const VERSIONS = [
  [...versionsKeys.standing(ID), 'mark'],
  [...versionsKeys.changes(ID), 'mark'],
  [...versionsKeys.dependencies(ID), 'mark'],
  [...versionsKeys.compatibility(ID), 'mark'],
  versionsKeys.locals,
  versionsKeys.registryDomains,
  versionsKeys.registryVersions('issues.astrale.ai'),
]
const DOMAIN = [qk.bundle(ID), qk.anatomy(ID), qk.comments(ID), qk.datasets(ID)]

function seeded(): QueryClient {
  const queryClient = new QueryClient()
  for (const key of [...VERSIONS, ...DOMAIN, qk.workspace, qk.layout(ID)])
    queryClient.setQueryData(key, { held: true })
  return queryClient
}
const invalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated === true

test('a refresh reads again where each Domain stands, its changes and its dependencies', () => {
  const queryClient = seeded()
  invalidateRefreshed(queryClient, [ID])
  for (const key of [...VERSIONS, ...DOMAIN, qk.workspace])
    expect([key, invalidated(queryClient, key)]).toEqual([key, true])
  // the reader's arrangement is not derived: nothing to read again
  expect(invalidated(queryClient, qk.layout(ID))).toBe(false)
})

test("a source change reads the Domain's derived reads again, and leaves the versions facts to their marks", () => {
  const queryClient = seeded()
  invalidateDomainReads(queryClient, ID)
  for (const key of DOMAIN) expect([key, invalidated(queryClient, key)]).toEqual([key, true])
  for (const key of VERSIONS) expect([key, invalidated(queryClient, key)]).toEqual([key, false])
})

test('a Publication read is kept: a refresh reads again only one the registry did not give', async () => {
  const queryClient = new QueryClient()
  const read = publishedDomainId('issues.astrale.ai', '0.9.0')
  const unread = publishedDomainId('issues.astrale.ai', '0.8.10')
  queryClient.setQueryData(qk.bundle(read), { held: true })
  await queryClient
    .fetchQuery({
      ...bundleQueryOptions(unread),
      queryFn: () => Promise.reject(new ApiError(401, '/bundle', '{}')),
    })
    .catch(() => undefined)
  invalidateRefreshed(queryClient, [])
  expect(invalidated(queryClient, qk.bundle(read))).toBe(false)
  expect(invalidated(queryClient, qk.bundle(unread))).toBe(true)
  // a read Publication is never asked again by itself
  const kept = bundleQueryOptions(read)
  expect(kept.retry).toBe(false)
  const readState = { state: { data: { held: true }, error: null } }
  expect(lifetimeOf(kept, readState)).toEqual([Number.POSITIVE_INFINITY, false])
  expect(bundleQueryOptions(ID)).not.toHaveProperty('retry')
  expect(bundleQueryOptions(ID)).not.toHaveProperty('staleTime')
})

type Held = Parameters<ReturnType<typeof answerLifetime>['staleTime']>[0]
/** An option as the query reads it: a function of the query, or a value. */
const resolved = (option: unknown, query: Held): unknown =>
  typeof option === 'function' ? (option as (query: Held) => unknown)(query) : option
const lifetimeOf = (options: { staleTime?: unknown; refetchInterval?: unknown }, query: Held) => [
  resolved(options.staleTime, query),
  resolved(options.refetchInterval, query),
]
const failure = (status: RemoteFailure['status']): RemoteFailure => ({
  status,
  message: `The registry answered ${status}.`,
  readAt: 'then',
})
const answer = (data: unknown): Held => ({ state: { data, error: null } })

test('a refusal stands no longer than a failed bundle, wherever an answer carries it', () => {
  const lifetime = answerLifetime(Number.POSITIVE_INFINITY)
  const ok = { status: 'ok', value: { publications: [] }, readAt: 'then' }
  // an answer stands as long as asked
  expect(lifetimeOf(lifetime, answer({ index: ok }))).toEqual([Number.POSITIVE_INFINITY, false])
  // a refusal, at the top of an answer or deep within it, stands `REFUSAL_STANDS_MS` and is read again
  for (const status of ['signed-out', 'offline', 'refused'] as const) {
    for (const data of [
      failure(status),
      { local: {}, index: failure(status) },
      { dependencies: [{ publications: { ...ok, value: [{ verdict: failure(status) }] } }] },
    ])
      expect([status, lifetimeOf(lifetime, answer(data))]).toEqual([
        status,
        [REFUSAL_STANDS_MS, REFUSAL_STANDS_MS],
      ])
  }
  // a shorter lifetime stays shorter
  expect(lifetimeOf(answerLifetime(5_000), answer(failure('signed-out')))).toEqual([
    5_000,
    REFUSAL_STANDS_MS,
  ])
  // an answer that the registry has nothing, and a read that broke, are no refusal
  for (const status of ['not-found', 'failed'] as const)
    expect(lifetimeOf(lifetime, answer({ index: failure(status) }))).toEqual([
      Number.POSITIVE_INFINITY,
      false,
    ])
  // a read refused outright holds the refusal as its error
  const refused = (status: RemoteFailure['status']): Held => ({
    state: {
      data: undefined,
      error: new ApiError(401, '/bundle', JSON.stringify(failure(status))),
    },
  })
  expect(lifetimeOf(lifetime, refused('signed-out'))[1]).toBe(REFUSAL_STANDS_MS)
  expect(lifetimeOf(lifetime, refused('failed'))[1]).toBe(false)
  expect(
    lifetimeOf(lifetime, {
      state: { data: undefined, error: new ApiError(500, '/bundle', 'x') },
    })[1],
  ).toBe(false)
})

test('a refusal kept by the page goes stale after it has stood, and Read again always reads', async () => {
  const queryClient = new QueryClient()
  const key = [...versionsKeys.standing(ID), 'mark']
  const lifetime = answerLifetime(Number.POSITIVE_INFINITY)
  let reads = 0
  const read = () => {
    reads += 1
    return Promise.resolve({ index: failure('signed-out') })
  }
  setSystemTime(new Date('2026-11-27T10:00:00Z'))
  try {
    await queryClient.fetchQuery({ queryKey: key, queryFn: read, ...lifetime })
    const query = queryClient.getQueryCache().find({ queryKey: key })!
    setSystemTime(new Date(Date.now() + REFUSAL_STANDS_MS - 1_000))
    expect(query.isStaleByTime(lifetime.staleTime(query))).toBe(false)
    setSystemTime(new Date(Date.now() + 2_000))
    expect(query.isStaleByTime(lifetime.staleTime(query))).toBe(true)
    // a fresh answer, read again at once, is read again all the same
    await readAgain(queryClient, { queryKey: key, queryFn: read, staleTime: 0 })
    await readAgain(queryClient, { queryKey: key, queryFn: read, staleTime: 0 })
    expect(reads).toBe(3)
  } finally {
    setSystemTime()
  }
})

test("a read the registry did not give carries the registry's own answer", () => {
  const failure: RemoteFailure = {
    status: 'signed-out',
    code: 'AUTH_ERROR',
    message: 'Sign in.',
    readAt: 'now',
  }
  expect(remoteFailureOf(new ApiError(401, '/bundle', JSON.stringify(failure)))).toEqual(failure)
  // a Studio failure, or any other error, is no registry answer
  expect(remoteFailureOf(new ApiError(500, '/bundle', 'boom'))).toBeUndefined()
  expect(remoteFailureOf(new ApiError(404, '/bundle', '{"error":"no"}'))).toBeUndefined()
  expect(remoteFailureOf(new Error('401 /bundle: {}'))).toBeUndefined()
  // and it reads as any error where it is only shown
  expect(String(new ApiError(401, '/bundle', 'x'))).toBe('Error: 401 /bundle: x')
})
