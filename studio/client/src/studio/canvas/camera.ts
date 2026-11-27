/**
 * The camera's one rule: when the Studio moves it on its own, and where to.
 *
 * - Entering a lens that draws the selection carried into it frames that selection's
 *   neighbourhood; the whole lens is where the camera stood before.
 * - Entering a lens with no selection, or one it does not draw, shows the whole lens.
 * - A selection is framed where its neighbourhood shows (`focusView`), unless the camera already
 *   shows it whole there, at the zoom it is framed at (`alreadyFramed`): then no card moves.
 * - When a selection the Studio framed ends, the camera goes back to where it stood before the
 *   Studio moved it, unless the reader panned or zoomed by hand meanwhile: it then stays where
 *   they left it.
 * - At rest — standing where it last showed the whole lens — the camera keeps showing it whole:
 *   as the lens is laid out anew (a fact arrives, a card changes) and as the room the pane
 *   leaves it changes. Moved since, by hand or for a selection, it is no longer at rest.
 *
 * Bringing a place of the selection into view (`reveal`) is the Studio moving the camera for the
 * selection too, and ends with it. Anything the reader does to the camera by hand — panning,
 * zooming, asking for a fit — makes the camera theirs.
 */

import type { Rect } from './geometry'

import { type FocusView, alreadyFramed } from './framing'
import { type Insets, shownSize, toWorld, type Viewport } from './viewport'

/** Where the camera stood, and where each box it showed stood then: what it goes back to. */
export interface Standing {
  view: Viewport
  boxes: ReadonlyMap<string, Rect>
}

/** Where the camera goes back to when the selection ends: where it stood, or the whole lens. */
export type Back = Standing | 'whole'

export interface Camera {
  /** where the camera stands, or is headed */
  view: Viewport
  pane: { width: number; height: number }
  insets: Insets
  /** the boxes the frame shown draws, where it draws them */
  boxes: ReadonlyMap<string, Rect>
  /** where it goes back to when the selection ends; none while the camera is the reader's */
  back: Back | null
  /** where the camera last showed the whole lens; none before it did */
  rest: Viewport | null
}

export type CameraCause =
  /** the reader entered a lens: whether it draws the selection they carry into it */
  | { kind: 'enter'; drawsSelection: boolean }
  /** a selection to frame at `target`; `drawnIn`: its neighbourhood is drawn in for it */
  | { kind: 'frame'; target: FocusView; drawnIn: boolean }
  /** a place of the selection to bring into view, at `to` */
  | { kind: 'reveal'; to: Viewport }
  /** the selection ended */
  | { kind: 'release' }
  /** the reader panned, zoomed or fitted by hand */
  | { kind: 'hand' }
  /** the lens was laid out anew, or the room the pane leaves it changed */
  | { kind: 'relaid' }

export type CameraMove =
  /** the camera stays; on entering a lens, the selection's framing follows */
  | { kind: 'stay' }
  /** the whole lens, in what the pane shows */
  | { kind: 'fit' }
  | { kind: 'go'; to: Viewport }

/** What `cause` does to the camera, and where it goes back to after. */
export function cameraFor(
  cause: CameraCause,
  camera: Camera,
): { move: CameraMove; back: Back | null } {
  const stay = { kind: 'stay' } as const
  switch (cause.kind) {
    case 'enter':
      // Where the camera stood was another lens: in this one, it stood before the whole lens.
      return cause.drawsSelection
        ? { move: stay, back: 'whole' }
        : { move: { kind: 'fit' }, back: null }
    case 'frame': {
      const { target } = cause
      if (!cause.drawnIn && alreadyFramed(camera.view, target, camera.pane, camera.insets))
        return { move: stay, back: camera.back }
      return {
        move: { kind: 'go', to: target.viewport },
        back: camera.back ?? standing(camera),
      }
    }
    case 'reveal':
      return sameView(cause.to, camera.view)
        ? { move: stay, back: camera.back }
        : { move: { kind: 'go', to: cause.to }, back: camera.back ?? standing(camera) }
    case 'release': {
      if (!camera.back) return { move: stay, back: null }
      if (camera.back === 'whole') return { move: { kind: 'fit' }, back: null }
      const to = standAgain(camera.back, camera)
      return { move: to ? { kind: 'go', to } : { kind: 'fit' }, back: null }
    }
    case 'hand':
      return { move: stay, back: null }
    case 'relaid':
      return {
        move: camera.rest && sameView(camera.view, camera.rest) ? { kind: 'fit' } : stay,
        back: camera.back,
      }
  }
}

const standing = (camera: Camera): Standing => ({ view: camera.view, boxes: camera.boxes })

const sameView = (a: Viewport, b: Viewport) =>
  Math.abs(a.zoom - b.zoom) < 1e-4 && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5

/**
 * The camera showing what `was` showed, in the frame now drawn: at its zoom, the box nearest the
 * middle of what it showed where it was on screen then. None when no box it showed is drawn.
 */
function standAgain(was: Standing, camera: Camera): Viewport | undefined {
  const room = shownSize(camera.pane, camera.insets)
  const middle = toWorld(was.view, {
    x: camera.insets.left + room.width / 2,
    y: camera.insets.top + room.height / 2,
  })
  let best: { then: Rect; now: Rect; away: number } | undefined
  for (const [id, then] of was.boxes) {
    const now = camera.boxes.get(id)
    if (!now) continue
    const away = Math.hypot(then.x + then.width / 2 - middle.x, then.y + then.height / 2 - middle.y)
    if (!best || away < best.away) best = { then, now, away }
  }
  if (!best) return undefined
  const { zoom } = was.view
  return {
    zoom,
    x: was.view.x - (best.now.x - best.then.x) * zoom,
    y: was.view.y - (best.now.y - best.then.y) * zoom,
  }
}
