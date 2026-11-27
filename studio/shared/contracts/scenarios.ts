/**
 * Scenarios: what a reader expects the Kernel to answer on one dataset, written down so the
 * Studio says when the answer changes. A Scenario is a named list of steps; a step is one
 * sentence — as an identity, read, traverse or call, on a Node or an Edge, expect it allowed or
 * refused. Each step is judged on the dataset as written: what a call would change is read from
 * its source as declared, never applied.
 *
 * Steps name what they act on as the dataset writes it — a Node by its path, an Edge by its ends
 * and relationship, a function by its handler key — so a step outlives an edit of the dataset
 * that keeps what it names, and says so when the edit removes it.
 *
 * This module owns the JSON written below `.domain-studio/scenarios.json` and the writes of its
 * route. It depends on nothing.
 */

/** The actor of a step that stands for an identity the dataset holds nothing about. */
export const ANYONE = '@anyone'

export type ScenarioExpect = 'allowed' | 'refused'

/** An Edge as a step names it: its ends' paths and its relationship, as the dataset writes them. */
export interface ScenarioEdge {
  readonly from: string
  readonly relation: string
  readonly to: string
}

export type ScenarioNode = { readonly node: string }
export type ScenarioOn = ScenarioNode | { readonly edge: ScenarioEdge }

/** What a step does: read a Node or an Edge, traverse an Edge, or call a function. */
export type ScenarioAct =
  | { readonly does: 'read'; readonly on: ScenarioOn }
  | { readonly does: 'traverse'; readonly on: { readonly edge: ScenarioEdge } }
  | {
      readonly does: 'call'
      /** the handler key: `Class.method`, or a Domain function's name */
      readonly fn: string
      /** the Node it is called on; none for a static Method or a Domain function */
      readonly on?: ScenarioNode
    }

export type ScenarioStep = ScenarioAct & {
  /** unique in its Scenario, kept through every edit */
  readonly id: string
  /** who acts: an identity Node's path, or `ANYONE` */
  readonly as: string
  readonly expect: ScenarioExpect
  /** the reader's own words for the step */
  readonly note?: string
}

export interface Scenario {
  readonly id: string
  /** the dataset's module path, as the Domain's config writes it */
  readonly dataset: string
  readonly name: string
  /** in the order they are read */
  readonly steps: readonly ScenarioStep[]
}

/** Every Scenario of a Domain, whatever its dataset. */
export interface ScenarioStore {
  readonly scenarios: readonly Scenario[]
  /**
   * How many times each Scenario was written, by its id; none for one never written since
   * revisions were kept. A write names the revision it was made from, and one made from an older
   * revision — another tab's, a hand edit's — is refused rather than undo it.
   */
  readonly revisions: Readonly<Record<string, number>>
}

/**
 * A write: a Scenario put whole — added, or in place of the one with its id — or one deleted,
 * each naming the revision it was made from (0 for a Scenario not written yet).
 */
export type ScenarioWrite =
  | { readonly action: 'put'; readonly scenario: Scenario; readonly revision: number }
  | { readonly action: 'delete'; readonly id: string; readonly revision: number }

/** The revision a write was made from: the store's, 0 for a Scenario not written yet. */
export const revisionOf = (store: ScenarioStore | undefined, id: string): number =>
  store?.revisions[id] ?? 0

/** An id of a Scenario or a step: letters, digits, `-` and `_`. */
export const SCENARIO_ID = /^[A-Za-z0-9_-]{1,64}$/

/** What one write may hold, in characters and counts. */
export const SCENARIO_LIMITS = {
  /** a Scenario's name */
  name: 120,
  /** a step's note */
  note: 280,
  /** a path, a relationship, a function key, a dataset's module path */
  reference: 512,
  steps: 200,
  /** Scenarios kept per Domain */
  scenarios: 500,
} as const
