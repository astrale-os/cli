/**
 * resize-handle.tsx: the one way anything in the Studio is resized.
 *
 * The domains rail, the docked work panel, the detail panel and the floating dock
 * each grew their own grip: a 6px strip here, an 8px one there, a line down the whole
 * edge on the columns but a 48px pill in the middle of the dock, a highlight that went
 * out as soon as a drag outran the pointer, double click and the keyboard on some and
 * not others. They all share this now, so every edge behaves the same:
 *
 * - an 8px grip, its whole length live;
 * - hovered, the WHOLE edge it moves lights up (after a beat, so sweeping the pointer
 *   across the window does not flicker every edge on the way);
 * - dragged, that edge stays solid until the button is released, wherever the pointer
 *   is, and the resize cursor holds over everything it passes;
 * - a double click puts the default size back;
 * - focused, the arrow keys step it by {@link RESIZE_STEP}px.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/** How far one arrow key press moves an edge, in px. */
export const RESIZE_STEP = 20

export type ResizeState = 'idle' | 'hover' | 'active'

/** How long the pointer rests on an edge before it lights, in ms. */
const HOVER_DELAY = 150

/** The edge's colour for a state: faint on hover, solid while it is being dragged. */
const RESIZE_TONE: Record<ResizeState, string> = {
  idle: 'bg-transparent',
  hover: 'bg-primary/60',
  active: 'bg-primary',
}

const RESIZE_RANK: Record<ResizeState, number> = { idle: 0, hover: 1, active: 2 }

/** The strongest of two states: a corner lighting an edge must not dim a drag on it. */
export function strongestResizeState(a: ResizeState, b: ResizeState): ResizeState {
  return RESIZE_RANK[a] >= RESIZE_RANK[b] ? a : b
}

/**
 * Hover, delayed on the way in and immediate on the way out, plus the drag. One state,
 * so the edge's colour and anyone listening agree on what the grip is doing.
 */
function useResizeState(onChange?: (state: ResizeState) => void) {
  const [hovered, setHovered] = useState(false)
  const [active, setActive] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const state: ResizeState = active ? 'active' : hovered ? 'hover' : 'idle'

  const report = useRef(onChange)
  report.current = onChange
  useEffect(() => report.current?.(state), [state])
  useEffect(() => () => clearTimeout(timer.current), [])

  const enter = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHovered(true), HOVER_DELAY)
  }, [])
  const leave = useCallback(() => {
    clearTimeout(timer.current)
    setHovered(false)
  }, [])
  return { state, enter, leave, setActive }
}

export interface ResizeHandleProps {
  /** `vertical` sits between two things side by side and moves along x. */
  orientation: 'vertical' | 'horizontal'
  /** Names the grip for assistive tech and in its tooltip. */
  label: string
  /** The cursor over the grip and, during a drag, over the whole window. */
  cursor?: string
  /** Where the grip sits: its position and size along the edge. */
  className?: string
  /** Where the lit line sits inside the grip; `false` when the surface draws its own. */
  line?: string | false
  /** A drag begins: snapshot the size the deltas will be added to. */
  onDragStart?: () => void
  /** The pointer's travel since the drag began, in px. */
  onDrag: (dx: number, dy: number) => void
  onDragEnd?: () => void
  /** Double click: back to the default size. */
  onReset?: () => void
  /** Arrow keys, in the same screen directions as a drag. */
  onStep?: (dx: number, dy: number) => void
  /** Home and End: to the smallest and the largest size. */
  onLimit?: (to: 'min' | 'max') => void
  onStateChange?: (state: ResizeState) => void
  /** Current size for `aria-valuenow`, with its bounds. */
  value?: number
  min?: number
  max?: number
  /** A corner only doubles two edges: it is no separator of its own, and not a tab stop. */
  role?: 'separator' | 'presentation'
  [data: `data-${string}`]: string | undefined
}

export function ResizeHandle({
  orientation,
  label,
  cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize',
  className,
  line,
  onDragStart,
  onDrag,
  onDragEnd,
  onReset,
  onStep,
  onLimit,
  onStateChange,
  value,
  min,
  max,
  role = 'separator',
  ...rest
}: ResizeHandleProps) {
  const { state, enter, leave, setActive } = useResizeState(onStateChange)
  const vertical = orientation === 'vertical'

  const drag = useRef<{ x: number; y: number } | null>(null)
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    setActive(false)
    releaseWindowCursor()
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    onDragEnd?.()
  }

  return (
    <div
      role={role}
      aria-orientation={role === 'separator' ? orientation : undefined}
      aria-label={role === 'separator' ? label : undefined}
      aria-valuenow={value === undefined ? undefined : Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={role === 'separator' ? 0 : undefined}
      title={onReset ? `${label} (double-click to reset)` : label}
      data-resize-state={state}
      {...rest}
      style={{ cursor }}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // the grip is the only thing a press here means: not a click on what is under
        // it, not a text selection starting, not the surface's own "open" press
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, y: event.clientY }
        setActive(true)
        holdWindowCursor(cursor)
        onDragStart?.()
      }}
      onPointerMove={(event) => {
        if (drag.current) onDrag(event.clientX - drag.current.x, event.clientY - drag.current.y)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const along = vertical
          ? { ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
          : { ArrowUp: [0, -1], ArrowDown: [0, 1] }
        const step = along[event.key as keyof typeof along] as [number, number] | undefined
        if (step && onStep) {
          event.preventDefault()
          onStep(step[0] * RESIZE_STEP, step[1] * RESIZE_STEP)
        } else if ((event.key === 'Home' || event.key === 'End') && onLimit) {
          event.preventDefault()
          onLimit(event.key === 'Home' ? 'min' : 'max')
        }
      }}
      className={cn(
        'group absolute z-30 touch-none select-none focus-visible:outline-none',
        className,
      )}
    >
      {line !== false && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute transition-colors duration-150',
            vertical
              ? 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2'
              : 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2',
            RESIZE_TONE[state],
            // the keyboard's way of saying "this is the edge you are on"
            state === 'idle' && 'group-focus-visible:bg-primary',
            line,
          )}
        />
      )}
    </div>
  )
}

/**
 * The resize cursor over the whole window for as long as a drag lasts, and no text
 * selection: pointer capture sends the events to the grip, but the cursor still follows
 * whatever is under the pointer, and a button or a canvas node swapped it mid-drag.
 */
function holdWindowCursor(cursor: string): void {
  const root = document.documentElement
  root.dataset.resizing = cursor
  root.style.setProperty('--resize-cursor', cursor)
}

function releaseWindowCursor(): void {
  const root = document.documentElement
  delete root.dataset.resizing
  root.style.removeProperty('--resize-cursor')
}
