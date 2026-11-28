/**
 * A state diagram without its looks: the layout of a machine at a size, which state the reader
 * points at or has pinned, and how each state and arrow reads because of it. A renderer draws
 * what this returns and spreads `stateProps` on whatever stands for a state; `state-diagram.tsx`
 * is the Studio's own.
 */

import { type KeyboardEvent, useCallback, useMemo, useState } from 'react'

import {
  type DiagramEdge,
  type DiagramLayout,
  type DiagramMetrics,
  layoutMachine,
  type Machine,
} from './layout'

/** `sm` fits a side panel and names no event; `md` names them; `lg` is read on its own. */
export type DiagramSize = 'sm' | 'md' | 'lg'

export const DIAGRAM_METRICS: Record<DiagramSize, DiagramMetrics> = {
  sm: {
    stateHeight: 22,
    statePad: 9,
    charWidth: 6.2,
    rankGap: 36,
    stateGap: 13,
    labels: false,
    labelCharWidth: 5.4,
    labelHeight: 11,
    arrow: 5.5,
    lane: 9,
    margin: 4,
  },
  md: {
    stateHeight: 26,
    statePad: 11,
    charWidth: 6.8,
    rankGap: 56,
    stateGap: 12,
    labels: true,
    labelCharWidth: 5.6,
    labelHeight: 12,
    arrow: 6.5,
    lane: 13,
    margin: 6,
  },
  lg: {
    stateHeight: 34,
    statePad: 16,
    charWidth: 7.9,
    rankGap: 88,
    stateGap: 18,
    labels: true,
    labelCharWidth: 6.4,
    labelHeight: 14,
    arrow: 8,
    lane: 18,
    margin: 10,
  },
}

/** How a state reads: the one pointed at, one a transition from or to it reaches, or neither. */
export type StateEmphasis = 'rest' | 'active' | 'near' | 'dim'
/** How an arrow reads: it leaves the state pointed at, enters it, or neither. */
export type EdgeEmphasis = 'rest' | 'leaves' | 'enters' | 'dim'

export interface StateDiagramOptions {
  size?: DiagramSize
  /** sizes that depart from the size's own */
  metrics?: Partial<DiagramMetrics>
  /** the state pointed at, when its owner holds it; the hook holds it otherwise */
  active?: string | null
  onActiveChange?: (state: string | null) => void
}

export interface StateDiagramModel {
  readonly layout: DiagramLayout
  readonly metrics: DiagramMetrics
  /** the state pointed at: hovered or focused, else pinned by a click */
  readonly active: string | undefined
  readonly pinned: string | undefined
  /** the arrows that leave and enter the active state */
  readonly leaving: readonly DiagramEdge[]
  readonly entering: readonly DiagramEdge[]
  readonly stateEmphasis: (state: string) => StateEmphasis
  readonly edgeEmphasis: (edge: DiagramEdge) => EdgeEmphasis
  /** what the element standing for a state takes: pointing, focus, and a click that pins */
  readonly stateProps: (state: string) => {
    tabIndex: number
    role: 'button'
    'aria-pressed': boolean
    onPointerEnter: () => void
    onPointerLeave: () => void
    onFocus: () => void
    onBlur: () => void
    onClick: () => void
    onKeyDown: (event: KeyboardEvent) => void
  }
  /** lets go of the state pointed at and of the one pinned */
  readonly clear: () => void
}

export function useStateDiagram(
  machine: Machine,
  { size = 'sm', metrics: overrides, active: held, onActiveChange }: StateDiagramOptions = {},
): StateDiagramModel {
  // the overrides are a few numbers, held by value: an object written inline lays out once
  const overrideKey = overrides ? JSON.stringify(overrides) : ''
  const metrics = useMemo(
    (): DiagramMetrics => ({
      ...DIAGRAM_METRICS[size],
      ...(overrideKey ? (JSON.parse(overrideKey) as Partial<DiagramMetrics>) : {}),
    }),
    [overrideKey, size],
  )
  const layout = useMemo(() => layoutMachine(machine, metrics), [machine, metrics])
  const [pointed, setPointed] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const known = (state: string | null | undefined) =>
    state !== null && state !== undefined && layout.states.some((one) => one.id === state)
      ? state
      : undefined
  const active = known(held === undefined ? (pointed ?? pinned) : held)

  const point = useCallback(
    (state: string | null) => {
      setPointed(state)
      onActiveChange?.(state ?? pinned)
    },
    [onActiveChange, pinned],
  )
  const pin = useCallback(
    (state: string) => {
      const next = pinned === state ? null : state
      setPinned(next)
      onActiveChange?.(next ?? pointed)
    },
    [onActiveChange, pinned, pointed],
  )
  const clear = useCallback(() => {
    setPointed(null)
    setPinned(null)
    onActiveChange?.(null)
  }, [onActiveChange])

  const leaving = useMemo(
    () => (active ? layout.edges.filter((edge) => edge.from === active) : []),
    [active, layout],
  )
  const entering = useMemo(
    () => (active ? layout.edges.filter((edge) => edge.to === active && edge.from !== active) : []),
    [active, layout],
  )
  const near = useMemo(
    () => new Set([...leaving.map((edge) => edge.to), ...entering.map((edge) => edge.from)]),
    [entering, leaving],
  )

  return {
    layout,
    metrics,
    active,
    pinned: known(pinned),
    leaving,
    entering,
    stateEmphasis: (state) =>
      active === undefined
        ? 'rest'
        : state === active
          ? 'active'
          : near.has(state)
            ? 'near'
            : 'dim',
    edgeEmphasis: (edge) =>
      active === undefined
        ? 'rest'
        : edge.from === active
          ? 'leaves'
          : edge.to === active
            ? 'enters'
            : 'dim',
    stateProps: (state) => ({
      tabIndex: 0,
      role: 'button',
      'aria-pressed': pinned === state,
      onPointerEnter: () => point(state),
      onPointerLeave: () => point(null),
      onFocus: () => point(state),
      onBlur: () => point(null),
      onClick: () => pin(state),
      onKeyDown: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        pin(state)
      },
    }),
    clear,
  }
}
