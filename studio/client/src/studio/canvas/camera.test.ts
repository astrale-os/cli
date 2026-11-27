import { describe, expect, test } from 'bun:test'

import type { FocusView } from './framing'
import type { Rect } from './geometry'

import { type Camera, cameraFor } from './camera'
import { fitViewport, type Viewport } from './viewport'

const PANE = { width: 1000, height: 600 }
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 }
const BOXES = new Map<string, Rect>([
  ['a', { x: 0, y: 0, width: 200, height: 80 }],
  ['b', { x: 600, y: 300, width: 200, height: 80 }],
  ['c', { x: 1400, y: 900, width: 200, height: 80 }],
])
/** The whole map, fitted: where the reader looks before anything is selected. */
const WHOLE = fitViewport({ x: 0, y: 0, width: 1600, height: 980 }, PANE)

const camera = (overrides: Partial<Camera> = {}): Camera => ({
  view: WHOLE,
  pane: PANE,
  insets: NO_INSETS,
  boxes: BOXES,
  back: null,
  rest: WHOLE,
  ...overrides,
})
/** A selection's neighbourhood framed at zoom 1 around `b`. */
const AROUND_B: FocusView = {
  viewport: { zoom: 1, x: -200, y: -40 },
  whole: true,
  shows: { x: 560, y: 260, width: 280, height: 160 },
}

describe('the camera follows one rule', () => {
  test('(a) entering a lens that draws the selection carried in frames it, the lens whole behind', () => {
    const { move, back } = cameraFor(
      { kind: 'enter', drawsSelection: true },
      camera({ back: { view: { zoom: 2, x: 0, y: 0 }, boxes: new Map() } }),
    )
    expect(move).toEqual({ kind: 'stay' })
    // where the camera stood was another lens: ending the selection shows this one whole
    expect(back).toBe('whole')
    const framed = cameraFor({ kind: 'frame', target: AROUND_B, drawnIn: false }, camera({ back }))
    expect(framed.move).toEqual({ kind: 'go', to: AROUND_B.viewport })
    expect(framed.back).toBe('whole')
    expect(cameraFor({ kind: 'release' }, camera({ back: framed.back })).move).toEqual({
      kind: 'fit',
    })
  })

  test('(b) entering a lens with no selection, or one it does not draw, fits the whole lens', () => {
    const zoomedIn = camera({ view: AROUND_B.viewport, back: 'whole' })
    const entered = cameraFor({ kind: 'enter', drawsSelection: false }, zoomedIn)
    expect(entered).toEqual({ move: { kind: 'fit' }, back: null })
  })

  test('(c) a framed selection, ended, goes back to where the camera stood', () => {
    const framed = cameraFor({ kind: 'frame', target: AROUND_B, drawnIn: false }, camera())
    expect(framed.move).toEqual({ kind: 'go', to: AROUND_B.viewport })
    // a second selection framed meanwhile keeps where the camera stood before the first
    const other = cameraFor(
      {
        kind: 'frame',
        target: {
          viewport: { zoom: 1, x: -1000, y: -640 },
          whole: true,
          shows: { x: 1360, y: 860, width: 280, height: 160 },
        },
        drawnIn: false,
      },
      camera({ view: AROUND_B.viewport, back: framed.back }),
    )
    const released = cameraFor({ kind: 'release' }, camera({ back: other.back }))
    expect(released).toEqual({ move: { kind: 'go', to: WHOLE }, back: null })
  })

  test('(c) the boxes having moved since, it goes back to what it showed, not to the place', () => {
    const framed = cameraFor({ kind: 'frame', target: AROUND_B, drawnIn: false }, camera())
    // the frame drawn after the selection ends stands every box 40 to the right, 10 down
    const moved = new Map(
      [...BOXES].map(([id, rect]) => [id, { ...rect, x: rect.x + 40, y: rect.y + 10 }]),
    )
    const { move } = cameraFor({ kind: 'release' }, camera({ boxes: moved, back: framed.back }))
    const to = (move as { to: Viewport }).to
    expect(to.zoom).toBe(WHOLE.zoom)
    expect(to.x).toBeCloseTo(WHOLE.x - 40 * WHOLE.zoom)
    expect(to.y).toBeCloseTo(WHOLE.y - 10 * WHOLE.zoom)
  })

  test('(c) a camera the reader moved by hand meanwhile stays where they left it', () => {
    const framed = cameraFor({ kind: 'frame', target: AROUND_B, drawnIn: false }, camera())
    const panned = cameraFor({ kind: 'hand' }, camera({ back: framed.back }))
    expect(panned.back).toBeNull()
    expect(cameraFor({ kind: 'release' }, camera({ back: panned.back })).move).toEqual({
      kind: 'stay',
    })
  })

  test('(d) a neighbourhood already whole in view keeps the camera, and nothing to go back to', () => {
    const atB = camera({ view: AROUND_B.viewport })
    const framed = cameraFor({ kind: 'frame', target: AROUND_B, drawnIn: false }, atB)
    expect(framed).toEqual({ move: { kind: 'stay' }, back: null })
    // drawn in for the selection, its cards move: the camera frames them
    const drawnIn = cameraFor({ kind: 'frame', target: AROUND_B, drawnIn: true }, atB)
    expect(drawnIn.move).toEqual({ kind: 'go', to: AROUND_B.viewport })
  })

  test('a place revealed for the selection goes back with it; one already in view moves nothing', () => {
    const to = { zoom: 0.8, x: -900, y: -500 }
    const revealed = cameraFor({ kind: 'reveal', to }, camera())
    expect(revealed.move).toEqual({ kind: 'go', to })
    expect(cameraFor({ kind: 'release' }, camera({ view: to, back: revealed.back })).move).toEqual({
      kind: 'go',
      to: WHOLE,
    })
    expect(cameraFor({ kind: 'reveal', to: { ...WHOLE } }, camera()).move).toEqual({
      kind: 'stay',
    })
  })

  test('(e) at rest on the whole lens, a lens laid out anew or a room changed shows it whole again', () => {
    expect(cameraFor({ kind: 'relaid' }, camera())).toEqual({ move: { kind: 'fit' }, back: null })
    // moved since — by hand, or for a selection — it is no longer at rest
    const panned = { ...WHOLE, x: WHOLE.x - 120 }
    expect(cameraFor({ kind: 'relaid' }, camera({ view: panned })).move).toEqual({ kind: 'stay' })
    const framed = cameraFor({ kind: 'frame', target: AROUND_B, drawnIn: false }, camera())
    expect(
      cameraFor({ kind: 'relaid' }, camera({ view: AROUND_B.viewport, back: framed.back })),
    ).toEqual({ move: { kind: 'stay' }, back: framed.back })
    // a camera that never showed the whole lens has no rest to keep
    expect(cameraFor({ kind: 'relaid' }, camera({ rest: null })).move).toEqual({ kind: 'stay' })
  })
})
