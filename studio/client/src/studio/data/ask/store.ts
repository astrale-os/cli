/**
 * What the reader asks of each dataset through Structure: the Query open, the values its slots
 * hold and why each was picked, who asks, the Node selected in the answer, and the size the
 * dataset is read at. Kept per dataset for the session.
 */

import { create } from 'zustand'

import type { Pick, Why } from './fill'

export interface AskView {
  /** the Query open, by its definition's id; none while the dataset is read measured */
  query?: string
  /** each slot's values, by slot id */
  values: Readonly<Record<string, readonly string[]>>
  /** why a slot holds the value it does, when the Studio picked it */
  picked: Readonly<Record<string, Why>>
  /** the Query the picks were made for: a Query is filled once, when it is opened */
  filled?: string
  /** who asks, by Node path; none reads the dataset whole, as the Domain itself does */
  as?: string
  /** the scene id selected in the answer or on the measure */
  selected?: string
  /** the Node selected when the Query was opened, by path: a slot that takes it is filled with it */
  carried?: string
  /** how many times the dataset is laid down (`scale.ts`) */
  factor: number
}

interface AskState {
  views: Record<string, AskView>
  panelOpen: boolean
  /** opens a Query, or none: its slots start free and are filled once */
  open: (scope: string, query: string | undefined) => void
  /** holds a slot to values, or frees it; what the reader sets is no pick */
  setValue: (scope: string, slot: string, values: readonly string[] | undefined) => void
  /** the picks made for the Query open */
  applyPicks: (scope: string, query: string, picks: readonly Pick[]) => void
  setAs: (scope: string, identity: string | undefined) => void
  select: (scope: string, id: string | undefined) => void
  setFactor: (scope: string, factor: number) => void
  setPanelOpen: (open: boolean) => void
}

const EMPTY: AskView = { values: {}, picked: {}, factor: 1 }
/** A Node's scene id, before its path (`names.ts`). */
const NODE = 'core.node.'

const without = <T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _dropped, ...rest } = record
  return rest
}

export const useAsk = create<AskState>((set) => {
  const change = (scope: string, next: (view: AskView) => AskView) =>
    set((state) => ({ views: { ...state.views, [scope]: next(state.views[scope] ?? EMPTY) } }))
  return {
    views: {},
    panelOpen: true,
    open: (scope, query) =>
      change(scope, ({ as, factor, selected }) => ({
        values: {},
        picked: {},
        factor,
        ...(as === undefined ? {} : { as }),
        ...(query === undefined ? {} : { query }),
        ...(query !== undefined && selected?.startsWith(NODE)
          ? { carried: selected.slice(NODE.length) }
          : {}),
      })),
    setValue: (scope, slot, values) =>
      change(scope, (view) => ({
        ...view,
        values: values?.length ? { ...view.values, [slot]: values } : without(view.values, slot),
        picked: without(view.picked, slot),
        selected: undefined,
      })),
    applyPicks: (scope, query, picks) =>
      change(scope, (view) =>
        view.query !== query
          ? view
          : {
              ...view,
              filled: query,
              values: {
                ...view.values,
                ...Object.fromEntries(picks.map((pick) => [pick.slot, [pick.path]])),
              },
              picked: {
                ...view.picked,
                ...Object.fromEntries(picks.map((pick) => [pick.slot, pick.why])),
              },
            },
      ),
    // A new reader is another question: the Query is filled again for what they may read.
    setAs: (scope, as) =>
      change(scope, ({ as: _before, filled: _filled, ...view }) => ({
        ...view,
        values: Object.fromEntries(
          Object.entries(view.values).filter(([slot]) => view.picked[slot] === undefined),
        ),
        picked: {},
        selected: undefined,
        ...(as === undefined ? {} : { as }),
      })),
    select: (scope, selected) => {
      change(scope, ({ selected: _before, ...view }) => ({
        ...view,
        ...(selected === undefined ? {} : { selected }),
      }))
      if (selected !== undefined) set({ panelOpen: true })
    },
    // Another size is another dataset: what was asked of the last one is let go.
    setFactor: (scope, factor) =>
      change(scope, ({ as, query }) => ({
        values: {},
        picked: {},
        factor,
        ...(as === undefined ? {} : { as }),
        ...(query === undefined ? {} : { query }),
      })),
    setPanelOpen: (panelOpen) => set({ panelOpen }),
  }
})

/** One dataset's question, as the level reads it. */
export const useAskView = (scope: string): AskView => useAsk((state) => state.views[scope] ?? EMPTY)
