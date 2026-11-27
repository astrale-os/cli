/**
 * The canvas's edge pointing to a selected rule's places it does not show: how many lie past
 * each edge, toward the nearest; one click brings the nearest into view, the next click the
 * next. A pointer keeps off the cards being read (`placePointers`). Read again whenever the
 * camera comes to rest, so the canvas never renders for it.
 */

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { Frame } from './frame'
import type { Rect } from './geometry'
import type { Insets, Viewport } from './viewport'

import { DOCK_CLEARANCE } from '../../schema-studio/palette'
import { type EdgePointer, offFrame, placePointers, placesOf, type PointerSize } from './off-frame'

const ARROW = { top: ArrowUp, right: ArrowRight, bottom: ArrowDown, left: ArrowLeft } as const
const WORD = { top: 'above', right: 'to the right', bottom: 'below', left: 'to the left' } as const
/** how far in from its edge a pointer sits */
const GAP = 10

const placesWord = (count: number) => `${count} ${count === 1 ? 'place' : 'places'}`

/**
 * A pointer's size as drawn below: 28 px high; its padding, border, arrow and gap, then its words
 * at about 6.6 px a character (12 px medium).
 */
const sizeOf = (pointer: EdgePointer): PointerSize => ({
  width: 40 + 6.6 * placesWord(pointer.ids.length).length,
  height: 28,
})

export interface Camera {
  viewport: Viewport
  pane: { width: number; height: number }
  insets: Insets
}

export function OffFramePointers({
  frame,
  rules,
  lit,
  camera,
  subscribe,
  onGo,
}: {
  /** the frame as drawn: a card raised with a fold open over the map at its full height */
  frame: Frame | null
  /** the rules the selection lights: a rule selected, or those that stand for it */
  rules: readonly string[]
  /** the boxes the selection lights, which a pointer keeps off; none: every box is read alike */
  lit: ReadonlySet<string> | null
  /** the camera as it now stands */
  camera: () => Camera
  /** calls back each time the camera comes to rest; returns how to stop */
  subscribe: (listener: () => void) => () => void
  /** brings a place into view */
  onGo: (id: string) => void
}) {
  const [, rested] = useState(0)
  useEffect(() => subscribe(() => rested((count) => count + 1)), [subscribe])
  const places = useMemo(
    () => (frame && rules.length > 0 ? placesOf(frame, rules) : new Map()),
    [frame, rules],
  )
  if (places.size === 0) return null
  const { viewport, pane, insets } = camera()
  if (pane.width === 0) return null
  // The agent's dock floats over the canvas's foot: a pointer there sits above it.
  const foot = Math.max(insets.bottom, DOCK_CLEARANCE)
  const shown = {
    left: insets.left,
    top: insets.top,
    right: pane.width - insets.right,
    bottom: pane.height - foot,
  }
  const pointers = offFrame(places, viewport, shown)
  if (pointers.length === 0) return null
  // The cards being read, where the pane draws them.
  const cover: Rect[] = []
  for (const [id, rect] of frame!.placement.boxes)
    if (!lit || lit.has(id))
      cover.push({
        x: rect.x * viewport.zoom + viewport.x,
        y: rect.y * viewport.zoom + viewport.y,
        width: rect.width * viewport.zoom,
        height: rect.height * viewport.zoom,
      })
  return (
    <>
      {placePointers(pointers, shown, cover, sizeOf, GAP).map(({ pointer, rect }) => (
        <Pointer key={pointer.side} pointer={pointer} rect={rect} onGo={onGo} />
      ))}
    </>
  )
}

function Pointer({
  pointer,
  rect,
  onGo,
}: {
  pointer: EdgePointer
  rect: Rect
  onGo: (id: string) => void
}) {
  const { side, ids } = pointer
  const Arrow = ARROW[side]
  const count = ids.length
  const said = `${placesWord(count)} ${WORD[side]}`
  const arrow = <Arrow className="h-3.5 w-3.5 shrink-0" aria-hidden />
  return (
    <button
      type="button"
      data-canvas-chrome
      data-offframe={side}
      data-offframe-count={count}
      aria-label={`${said}: show the nearest`}
      title={`${said} — click to show the nearest`}
      style={{ left: rect.x, top: rect.y, minWidth: rect.width }}
      className="pointer-events-auto absolute z-20 inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-full border bg-card px-2.5 text-[12px] font-medium text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.08)] transition-colors hover:bg-accent"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onGo(ids[0]!)
      }}
    >
      {side === 'left' || side === 'top' ? arrow : null}
      <span>{placesWord(count)}</span>
      {side === 'right' || side === 'bottom' ? arrow : null}
    </button>
  )
}
