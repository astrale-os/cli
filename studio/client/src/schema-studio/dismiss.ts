import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Close open menus when the canvas is pressed.
 *
 * React Flow's pane and drag handlers stop the pointer event (d3-zoom /
 * d3-drag), so Radix's dismissable layers never see the press and a popover
 * opened from the header stayed open while you clicked around the graph. Re-emit
 * the press on the document — which is exactly what "you clicked outside" means.
 */
export function dismissMenusOnCanvasPress(event: ReactPointerEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.react-flow')) return
  // `nodrag`/`nopan` elements (comment pins, popover triggers on the canvas) are NOT
  // swallowed by React Flow — Radix already sees those presses, and re-emitting one
  // would dismiss the very popover the click just opened.
  if (target.closest('.nodrag, .nopan')) return
  // after the press, not inside it: the real event is swallowed mid-flight, and a
  // nested dispatch is treated as part of that same (intercepted) interaction
  setTimeout(() => {
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        pointerId: 1,
        isPrimary: true,
      }),
    )
  }, 0)
}
