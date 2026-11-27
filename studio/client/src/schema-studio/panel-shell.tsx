import { PanelRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ResizeHandle } from '@/components/ui/resize-handle'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { StageDock } from '@/studio/stage/staged'
import { useStage } from '@/studio/stage/store'

/** The panel's default width, restored by a double click on its edge. */
const DEFAULT_WIDTH = 420
const MIN_WIDTH = 320
const MAX_WIDTH = 900
/** The narrowest canvas a docked panel leaves beside it. */
const CANVAS_FLOOR = 360
/** The strip of canvas a floating panel leaves uncovered, so it reads as laid over the canvas. */
const SHEET_MARGIN = 48
/** The modules rail beside the panel, when its section has one. */
const RAIL_SELECTOR = ':scope > [data-testid="modules-sidebar"]'

/**
 * The detail panel on the right of a canvas. It docks beside the canvas while the canvas keeps
 * `CANVAS_FLOOR` next to the panel at its narrowest; on a narrower window it floats over the
 * canvas instead, which keeps its whole width beneath, until it is closed. While what it shows
 * stages something (`Staged`), the stage stands at the foot of the view across the canvas and
 * the panel, which ends above it.
 */
export function PanelShell({
  onClose,
  onCover,
  children,
}: {
  onClose: () => void
  /** Told the width the panel lies over the canvas: its own while it floats, else 0. */
  onCover?: (width: number) => void
  children: React.ReactNode
}) {
  const preferredWidth = useUI((state) => state.detailWidth)
  const setWidth = useUI((state) => state.setDetailWidth)
  const panel = useRef<HTMLDivElement>(null)
  const dragFrom = useRef(preferredWidth)
  // what the canvas and the panel share: the view beside the rail
  const [room, setRoom] = useState(MAX_WIDTH + CANVAS_FLOOR)
  const docked = room - MIN_WIDTH >= CANVAS_FLOOR
  const max = Math.max(0, Math.min(MAX_WIDTH, room - (docked ? CANVAS_FLOOR : SHEET_MARGIN)))
  const min = Math.min(MIN_WIDTH, max)
  const width = Math.min(preferredWidth, max)
  const resize = (next: number) => setWidth(Math.min(max, Math.max(min, next)))
  const staging = useStage((state) => state.staged > 0 && state.open)
  const [stage, setStage] = useState(0)

  // A docked panel takes the view's full height: the floating dock keeps to the canvas beside
  // it. A floating one lies over the canvas, the dock included, and takes nothing from either.
  const setAside = useUI((state) => state.setAside)
  useLayoutEffect(() => setAside('right', docked ? width : 0), [docked, setAside, width])
  useLayoutEffect(() => () => setAside('right', 0), [setAside])
  const cover = useRef(onCover)
  cover.current = onCover
  useLayoutEffect(() => cover.current?.(docked ? 0 : width), [docked, width])
  useLayoutEffect(() => () => cover.current?.(0), [])

  useEffect(() => {
    const container = panel.current?.parentElement
    if (!container) return
    const measure = () => {
      const rail = container.querySelector<HTMLElement>(RAIL_SELECTOR)
      setRoom(container.clientWidth - (rail?.offsetWidth ?? 0))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    for (const rail of container.querySelectorAll(RAIL_SELECTOR)) observer.observe(rail)
    measure()
    return () => observer.disconnect()
  }, [])

  // One element in both modes, so what the panel holds is never mounted again: docked, its slot
  // in the row is as wide as it is; floating, the slot is empty and the panel hangs left of it.
  return (
    <div ref={panel} style={{ width: docked ? width : 0 }} className="relative min-h-0 shrink-0">
      <div
        data-testid="detail-panel"
        data-docked={docked}
        style={{ width, bottom: stage }}
        className={cn(
          'absolute inset-y-0 right-0 border-l bg-card',
          !docked && 'z-40 shadow-[-12px_0_32px_-16px_rgb(0_0_0/0.35)]',
        )}
      >
        <ResizeHandle
          orientation="vertical"
          label="Resize detail panel"
          className="left-0 top-0 h-full w-2 -translate-x-1/2"
          value={width}
          min={min}
          max={max}
          // the grip is on the panel's left edge: dragging left widens it
          onDragStart={() => (dragFrom.current = width)}
          onDrag={(dx) => resize(dragFrom.current - dx)}
          onStep={(dx) => resize(width - dx)}
          onLimit={(to) => resize(to === 'min' ? min : max)}
          onReset={() => resize(DEFAULT_WIDTH)}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          title="Close (Esc)"
          className="absolute right-3.5 top-3.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-md bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
      {staging && <StageDock width={room} onShown={setStage} />}
    </div>
  )
}

/**
 * Opens a level's panel again once it is closed. It keeps to the canvas's right edge below the
 * canvas toolbar, which holds the corner itself (zoom, fit, Auto-arrange) at every width.
 */
export function PanelOpener({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute right-3 top-14 z-10 inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-2.5 text-[13px] text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <PanelRight className="h-4 w-4" />
      {label}
    </button>
  )
}
