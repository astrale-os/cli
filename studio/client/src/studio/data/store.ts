/**
 * What the Data level remembers while the Studio is open, per dataset of a Domain: the selection
 * on the map, the identity the Rules lens reads as, the verdict the map lights, the Scenario the
 * Behavior lens has open and its step selected, and whether the panel is shown. Switching the
 * identity or the lens keeps the selection; another dataset has its own. A step selected is a
 * selection, an identity and a verdict at once, so the Rules lens reads it where it stands.
 * Nothing here is written anywhere: Scenarios themselves are kept by the server.
 */

import { ANYONE } from '@shared/contracts/scenarios'
import { create } from 'zustand'

/** One dataset of one Domain. */
export const datasetScope = (domainId: string, datasetId: string) => `${domainId}|${datasetId}`

export interface DatasetView {
  /** the selected scene id: `core.node.<path>`, `core.edge.<i>`, a region, a gathered link, an end */
  selected?: string
  /** the identity Rules reads as: a Node's path, or anyone */
  identity: string
  /** the verdict the map lights for the selection, by id */
  verdict?: string
  /** the Scenario the Behavior lens has open, by id */
  scenario?: string
  /** the step of the open Scenario selected, by id: it holds while the selection, identity and verdict it set do */
  step?: string
}

interface DataViewState {
  views: Record<string, DatasetView>
  /** a scene id to bring into view once */
  reveal: string | null
  panelOpen: boolean
  select: (scope: string, id: string | undefined, reveal?: boolean) => void
  setIdentity: (scope: string, identity: string) => void
  /** lights one verdict's proof on the map; the same one again, or none, lights the selection */
  lightVerdict: (scope: string, verdict: string | undefined) => void
  /** opens a Scenario, or none: the selection and the step it held are let go */
  openScenario: (scope: string, scenario: string | undefined) => void
  /** selects a step: what it acts on, as whom, and the verdict it is judged by */
  selectStep: (
    scope: string,
    step: {
      scenario: string
      step: string
      selected?: string
      identity: string
      verdict?: string
    },
  ) => void
  /** puts a dataset's view back as an address names it; an identity it does not name is anyone */
  restore: (scope: string, view: Partial<DatasetView>) => void
  revealed: () => void
  setPanelOpen: (open: boolean) => void
}

const EMPTY: DatasetView = { identity: ANYONE }

export const useDataView = create<DataViewState>((set) => ({
  views: {},
  reveal: null,
  panelOpen: true,
  select: (scope, selected, reveal = false) =>
    set((state) => {
      const {
        verdict: _verdict,
        selected: _selected,
        step: _step,
        ...rest
      } = state.views[scope] ?? EMPTY
      return {
        views: { ...state.views, [scope]: { ...rest, ...(selected ? { selected } : {}) } },
        panelOpen: true,
        ...(reveal && selected ? { reveal: selected } : {}),
      }
    }),
  setIdentity: (scope, identity) =>
    set((state) => {
      const { verdict: _verdict, step: _step, ...rest } = state.views[scope] ?? EMPTY
      return { views: { ...state.views, [scope]: { ...rest, identity } } }
    }),
  lightVerdict: (scope, verdict) =>
    set((state) => {
      const { verdict: current, step: _step, ...rest } = state.views[scope] ?? EMPTY
      const next = verdict === current ? undefined : verdict
      return { views: { ...state.views, [scope]: { ...rest, ...(next ? { verdict: next } : {}) } } }
    }),
  openScenario: (scope, scenario) =>
    set((state) => {
      const { identity } = state.views[scope] ?? EMPTY
      return {
        views: { ...state.views, [scope]: { identity, ...(scenario ? { scenario } : {}) } },
        panelOpen: true,
      }
    }),
  selectStep: (scope, { scenario, step, selected, identity, verdict }) =>
    set((state) => ({
      views: {
        ...state.views,
        [scope]: {
          identity,
          scenario,
          step,
          ...(selected ? { selected } : {}),
          ...(verdict ? { verdict } : {}),
        },
      },
      panelOpen: true,
      ...(selected ? { reveal: selected } : {}),
    })),
  restore: (scope, { identity, selected, verdict, scenario, step }) =>
    set((state) => ({
      views: {
        ...state.views,
        [scope]: {
          identity: identity ?? ANYONE,
          ...(selected ? { selected } : {}),
          ...(verdict ? { verdict } : {}),
          ...(scenario ? { scenario } : {}),
          ...(scenario && step ? { step } : {}),
        },
      },
    })),
  revealed: () => set({ reveal: null }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}))

/** One dataset's view, as the level reads it. */
export const useDatasetView = (scope: string): DatasetView =>
  useDataView((state) => state.views[scope] ?? EMPTY)
