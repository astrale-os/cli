/**
 * What the Workspace level knows of each Domain, one fact at a time. Every fact carries its own
 * state, so a slow or failed read — a registry that cannot be reached, a judgement still running —
 * never blanks the others: the local facts stand on their own.
 *
 * A fact is the Studio server's answer. A remote fact inside it (`Remote<T>`) carries the
 * registry's own status; `error` here means the Studio server itself gave no answer.
 */

import type {
  ChangeReport,
  CompatibilityMatrix,
  DomainDependencies,
  DomainLocal,
  DomainStanding,
  Remote,
} from '@shared/contracts/versions'
import type { DomainSummary } from '@shared/contracts/workspace'

export type Fact<T> =
  /** Not asked for: the cost guard leaves it until the Domain is selected. */
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T; /** a newer answer is being read */ refreshing: boolean }
  /** The Studio server gave no answer. */
  | { status: 'error'; message: string }

export const IDLE: Fact<never> = { status: 'idle' }
export const LOADING: Fact<never> = { status: 'loading' }

export function ready<T>(value: T, refreshing = false): Fact<T> {
  return { status: 'ready', value, refreshing }
}

export function valueOf<T>(fact: Fact<T>): T | undefined {
  return fact.status === 'ready' ? fact.value : undefined
}

/** A react-query result as a fact. */
export function factOf<T>(
  query: { data?: T; error: unknown; isFetching: boolean },
  enabled: boolean,
): Fact<T> {
  if (query.data !== undefined) return ready(query.data, query.isFetching)
  if (query.error) {
    return {
      status: 'error',
      message: query.error instanceof Error ? query.error.message : String(query.error),
    }
  }
  return enabled || query.isFetching ? LOADING : IDLE
}

/** Everything the Workspace level reads of one workspace Domain. */
export interface DomainFacts {
  summary: DomainSummary
  /** Its sources on disk; never waits on the network. */
  local: Fact<DomainLocal>
  standing: Fact<DomainStanding>
  dependencies: Fact<DomainDependencies>
  /** The platform's change report: heavy, judged by `astrale-domain diff`. */
  changes: Fact<Remote<ChangeReport>>
  /** Every dependency version judged: heavy, one compare per Schema revision. */
  compatibility: Fact<CompatibilityMatrix>
}

/** The workspace Domain whose Schema has `origin`, by its local facts or its summary. */
export function domainOfOrigin(
  domains: readonly DomainFacts[],
  origin: string,
): DomainFacts | undefined {
  return domains.find(
    (domain) => (valueOf(domain.local)?.origin ?? domain.summary.origin) === origin,
  )
}

/** The Domain's origin: its Schema's once read, else the one the workspace scan found. */
export function originOf(domain: DomainFacts): string {
  return valueOf(domain.local)?.origin ?? domain.summary.origin
}
