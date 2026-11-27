/**
 * What the canvas remembers outside the selection: what the pointer is over, what a panel
 * points at — things, or a step of the walk drawn — which groups are collapsed, the isolated
 * neighbourhood, and each lens's options. The selection itself stays in the Studio's store — ⌘K, reveal and comments
 * share it.
 */

import { create } from 'zustand'

import type { LensOptions } from '../scene/types'

/**
 * What a panel points at on the canvas — the Inspector's rule sites, a Rules row: selection
 * target ids (`class.Issue`, `class.assignedTo`, `function.Issue.archive`, `module.<path>`)
 * of one Domain. The canvas lights them as it lights a selection, each through what stands
 * for it when the lens does not draw it, and the selection stays exactly as it was. Whoever
 * sets a spotlight clears it; while one is set it is what the canvas lights.
 */
export interface Spotlight {
  domainId: string
  ids: readonly string[]
}

interface CanvasState {
  /** the box, chip, trunk or link under the pointer — or under the Index's pointer */
  hovered: string | null
  /** the step of the walk drawn that the stage points at: its chips stand out, the others dim */
  step: number | null
  spotlight: Spotlight | null
  /** collapsed groups per `<domain>:<lens>`; absent means the scene's default */
  collapsed: Record<string, readonly string[]>
  /** the id `F` isolated, per `<domain>:<lens>` */
  isolated: Record<string, string>
  options: Record<string, LensOptions>
  setHovered: (id: string | null) => void
  setStep: (step: number | null) => void
  /** Light `ids` of `domainId` without selecting them; null or no ids lights the selection again. */
  setSpotlight: (domainId: string, ids: readonly string[] | null) => void
  setCollapsed: (scope: string, groups: readonly string[]) => void
  setIsolated: (scope: string, id: string | null) => void
  setOption: (lens: string, option: string, value: boolean) => void
}

export const useCanvas = create<CanvasState>((set) => ({
  hovered: null,
  step: null,
  spotlight: null,
  collapsed: {},
  isolated: {},
  options: {},
  setHovered: (hovered) => set((state) => (state.hovered === hovered ? {} : { hovered })),
  setStep: (step) => set((state) => (state.step === step ? {} : { step })),
  setSpotlight: (domainId, ids) =>
    set({ spotlight: ids && ids.length > 0 ? { domainId, ids: [...ids] } : null }),
  setCollapsed: (scope, groups) =>
    set((state) => ({ collapsed: { ...state.collapsed, [scope]: groups } })),
  setIsolated: (scope, id) =>
    set((state) => {
      const { [scope]: _left, ...rest } = state.isolated
      return { isolated: id ? { ...rest, [scope]: id } : rest }
    }),
  setOption: (lens, option, value) =>
    set((state) => ({
      options: { ...state.options, [lens]: { ...state.options[lens], [option]: value } },
    })),
}))
