/**
 * The stage's band and what draws into it. `StageDock` is the band: docked at the foot of the
 * view beside the rail, across the canvas and the Inspector, so a Figure as wide as a rule makes
 * it has the room the Inspector's column never gives it. It shows while a view stages something
 * (`Staged`) and the reader keeps it open; its top edge resizes it, one control enlarges it over
 * the canvas and the Inspector, another closes it. Where the agent's composer floats over the
 * canvas, it steps aside while the band shows, and opened from the band it stands above it:
 * neither covers the other.
 *
 * `Staged` draws its children into the band, inside the rule scope it is rendered in: what they
 * point at lights the Inspector's words too. Closed, it offers to open the band where it stands.
 */

import { Maximize2, Minimize2, PanelBottomOpen, X } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { AgentAsideButton } from '@/components/work-panel/agent-tab'
import { cn } from '@/lib/utils'

import { TOOLBAR_CLEARANCE } from '../../schema-studio/palette'
import { STAGE_CANVAS_FLOOR, STAGE_HEIGHT, stageHeightIn, useStage } from './store'

/**
 * The band, `width` wide from the view's right edge. Told the height it stands at (`onShown`):
 * what the Inspector above it leaves itself.
 */
export function StageDock({
  width,
  onShown,
}: {
  width: number
  onShown: (height: number) => void
}) {
  const height = useStage((state) => state.height)
  const enlarged = useStage((state) => state.enlarged)
  const setHeight = useStage((state) => state.setHeight)
  const setEnlarged = useStage((state) => state.setEnlarged)
  const setOpen = useStage((state) => state.setOpen)
  const setSlot = useStage((state) => state.setSlot)
  const setCover = useStage((state) => state.setCover)
  const wants = useStage((state) => state.wants)
  const dock = useRef<HTMLDivElement>(null)
  const dragFrom = useRef(0)
  // the view's height: the band never takes the canvas toolbar nor the least of the canvas
  const [full, setFull] = useState(0)
  useLayoutEffect(() => {
    const view = dock.current?.parentElement
    if (!view) return
    const measure = () => setFull(view.clientHeight)
    const observer = new ResizeObserver(measure)
    observer.observe(view)
    measure()
    return () => observer.disconnect()
  }, [])
  const max = Math.max(STAGE_HEIGHT.min, full - TOOLBAR_CLEARANCE - STAGE_CANVAS_FLOOR)
  const shown = Math.min(stageHeightIn(full, height, wants), full === 0 ? Infinity : max)
  const drawn = enlarged && full > 0 ? full : shown
  const resize = (next: number) => setHeight(Math.min(max, Math.max(STAGE_HEIGHT.min, next)))

  // Framing leaves free what the band covers at its height: enlarged, it covers the canvas
  // for a moment, and the camera keeps where it stood under it.
  useLayoutEffect(() => setCover(shown), [setCover, shown])
  useLayoutEffect(() => () => setCover(0), [setCover])
  const told = useRef(onShown)
  told.current = onShown
  useLayoutEffect(() => told.current(drawn), [drawn])
  useLayoutEffect(() => () => told.current(0), [])

  // Enlarged, Esc puts it back before it backs out of anything else.
  useEffect(() => {
    if (!enlarged) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      setEnlarged(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enlarged, setEnlarged])

  return (
    <div
      ref={dock}
      data-testid="rule-stage"
      data-stage=""
      data-enlarged={enlarged ? '' : undefined}
      style={{ width, height: drawn }}
      className={cn(
        'absolute bottom-0 right-0 z-20 flex flex-col border-t bg-card',
        'shadow-[0_-12px_32px_-20px_rgb(0_0_0/0.35)]',
      )}
    >
      {!enlarged && (
        <ResizeHandle
          orientation="horizontal"
          label="Resize the stage"
          className="left-0 top-0 h-2 w-full -translate-y-1/2"
          value={shown}
          min={STAGE_HEIGHT.min}
          max={max}
          // the grip is on the band's top edge: dragging up raises it
          onDragStart={() => (dragFrom.current = shown)}
          onDrag={(_dx, dy) => resize(dragFrom.current - dy)}
          onStep={(_dx, dy) => resize(shown - dy)}
          onLimit={(to) => resize(to === 'min' ? STAGE_HEIGHT.min : max)}
          onReset={() => setHeight(null)}
        />
      )}
      <div className="absolute right-2 top-1.5 z-10 flex items-center gap-0.5">
        {/* the composer steps aside while the stage stands open: this brings it back */}
        <AgentAsideButton />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-stage-enlarge=""
          aria-pressed={enlarged}
          aria-label={enlarged ? 'Put the stage back' : 'Enlarge the stage'}
          title={enlarged ? 'Put back (Esc)' : 'Enlarge over the canvas'}
          onClick={() => setEnlarged(!enlarged)}
          className="h-7 w-7"
        >
          {enlarged ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-stage-close=""
          aria-label="Close the stage"
          title="Close the stage"
          onClick={() => setOpen(false)}
          className="h-7 w-7"
        >
          <X aria-hidden />
        </Button>
      </div>
      <div ref={setSlot} className="min-h-0 flex-1" />
    </div>
  )
}

/**
 * Draws `children` into the stage while it is open; closed, offers to open it here. `label`
 * says what opening it shows.
 */
export function Staged({ label, children }: { label: string; children: ReactNode }) {
  const open = useStage((state) => state.open)
  const slot = useStage((state) => state.slot)
  const enter = useStage((state) => state.enter)
  const leave = useStage((state) => state.leave)
  const setOpen = useStage((state) => state.setOpen)
  useLayoutEffect(() => {
    enter()
    return leave
  }, [enter, leave])
  if (!open)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-stage-open=""
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        <PanelBottomOpen aria-hidden />
        {label}
      </Button>
    )
  if (!slot) return null
  return createPortal(<div className="studio-rules h-full">{children}</div>, slot)
}
