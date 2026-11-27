/**
 * Whether the reader pointed at something. Content moving under a still pointer — the camera
 * gliding to frame a selection, the Index's rows reflowing as it filters — brings another
 * element under it, and the browser reports the pointer over that element. That is not a
 * hover: lit by it, the lines of whatever slid under the pointer would read as part of the
 * new focus. A pointer-over counts only where the pointer itself last moved somewhere else.
 */

export interface PointerWatch {
  /** The pointer moved to (x, y), in client pixels. */
  moved(x: number, y: number): void
  /** An element reports the pointer over it at (x, y): whether the reader pointed at it. */
  pointed(x: number, y: number): boolean
}

export function pointerWatch(): PointerWatch {
  let at: { x: number; y: number } | null = null
  return {
    moved(x, y) {
      at = { x, y }
    },
    pointed(x, y) {
      const fresh = at === null || at.x !== x || at.y !== y
      at = { x, y }
      return fresh
    },
  }
}

/** The page's one watch: every pointer move reaches it before any element hears of it. */
export const pointing = pointerWatch()

if (typeof window !== 'undefined')
  window.addEventListener('pointermove', (event) => pointing.moved(event.clientX, event.clientY), {
    capture: true,
    passive: true,
  })
