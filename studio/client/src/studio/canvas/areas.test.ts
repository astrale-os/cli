import { describe, expect, test } from 'bun:test'

import type { Arrangement } from '../scene/arrange'
import type { Scene } from '../scene/types'
import type { Point, Rect } from './geometry'
import type { Placement } from './layout'

import {
  HOME,
  homeBundle,
  PEER,
  peerBundle,
  THIRD,
  thirdBundle,
  whole,
} from '../lenses/__tests__/several-domains'
import { composeStructure } from '../lenses/structure'
import { arrange, defaultCollapsed } from '../scene/arrange'
import { bundledElk } from './__tests__/bundled-elk'
import { AREA_GAP, packAreas } from './areas'
import { layoutArrangement, routeEnds } from './layout'
import { estimateText } from './metrics'
import { pinPlacement, type Pins, settleDrop } from './pins'

const holds = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5
const apart = (a: Rect, b: Rect, gap = 0) =>
  a.x + a.width + gap <= b.x + 0.5 ||
  b.x + b.width + gap <= a.x + 0.5 ||
  a.y + a.height + gap <= b.y + 0.5 ||
  b.y + b.height + gap <= a.y + 0.5
const touches = (rect: Rect, point: Point, slack = 1) =>
  point.x >= rect.x - slack &&
  point.x <= rect.x + rect.width + slack &&
  point.y >= rect.y - slack &&
  point.y <= rect.y + rect.height + slack

async function laid(scene: Scene) {
  const arrangement = arrange(scene, { collapsed: defaultCollapsed(scene) })
  const auto = await layoutArrangement(arrangement, 'compact', estimateText, bundledElk())
  return { arrangement, auto }
}

/** Every area frame holds its boxes and modules; no two frames come closer than `gap`. */
function expectFramed(placement: Placement, arrangement: Arrangement, gap = 0) {
  const frames = [...placement.areas!]
  expect(frames.map(([id]) => id)).toEqual(arrangement.areas!.map((area) => area.id))
  for (const area of arrangement.areas!) {
    const frame = placement.areas!.get(area.id)!
    for (const id of area.members)
      expect({ id, held: holds(frame, placement.boxes.get(id)!) }).toEqual({ id, held: true })
    for (const region of arrangement.regions)
      if (area.members.includes(region.members[0]!))
        expect(holds(frame, placement.regions.get(region.id)!)).toBe(true)
  }
  for (const [index, [a, rect]] of frames.entries())
    for (const [b, other] of frames.slice(index + 1))
      expect({ pair: [a, b], apart: apart(rect, other, gap) }).toEqual({
        pair: [a, b],
        apart: true,
      })
}

function expectRoutesOnTheirEnds(placement: Placement, arrangement: Arrangement) {
  for (const [id, from, to] of routeEnds(arrangement)) {
    const route = placement.routes.get(id)!
    expect(route.length).toBeGreaterThanOrEqual(2)
    expect(touches(placement.boxes.get(from)!, route[0]!)).toBe(true)
    expect(touches(placement.boxes.get(to)!, route.at(-1)!)).toBe(true)
  }
}

describe('packing areas', () => {
  test('in Scene order, the first at the origin, in the rows that read largest in a landscape view', () => {
    const size = { width: 1000, height: 600 }
    expect(packAreas([size])).toEqual([{ x: 0, y: 0 }])
    expect(packAreas([size, size])).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 600 + AREA_GAP },
    ])
    const square = { width: 600, height: 600 }
    expect(packAreas([square, square])).toEqual([
      { x: 0, y: 0 },
      { x: 600 + AREA_GAP, y: 0 },
    ])
    expect(packAreas([size, size, size])).toEqual([
      { x: 0, y: 0 },
      { x: 1000 + AREA_GAP, y: 0 },
      { x: 0, y: 600 + AREA_GAP },
    ])
  })

  test('no two areas come closer than the gap, whatever their sizes', () => {
    const sizes = [
      { width: 2400, height: 900 },
      { width: 300, height: 1400 },
      { width: 800, height: 200 },
      { width: 640, height: 640 },
      { width: 120, height: 90 },
    ]
    const corners = packAreas(sizes)
    const rects = sizes.map((size, index) => ({ ...corners[index]!, ...size }))
    for (const [index, rect] of rects.entries())
      for (const other of rects.slice(index + 1)) expect(apart(rect, other, AREA_GAP)).toBe(true)
  })
})

describe('a canvas of several Domains', () => {
  test('each area opens with its groups collapsed as its own canvas would', () => {
    const scene = composeStructure(homeBundle(), {}, whole(peerBundle()))
    expect(defaultCollapsed(scene)).toEqual(new Set())
    // past two nodes: the open Domain's area, of two groups, collapses; the peer's, of one, cannot
    expect(defaultCollapsed(scene, 2)).toEqual(
      new Set(
        scene.groups.filter((group) => group.area === `area.${HOME}`).map((group) => group.id),
      ),
    )
  })

  test('is laid out one area at a time: framed, packed apart, every line routed between its ends', async () => {
    const scene = composeStructure(homeBundle(), {}, whole(peerBundle(), thirdBundle()))
    const { arrangement, auto } = await laid(scene)
    expect(arrangement.areas?.map((area) => area.id)).toEqual([
      `area.${HOME}`,
      `area.${PEER}`,
      `area.${THIRD}`,
    ])
    expectFramed(auto, arrangement, AREA_GAP - 1)
    expectRoutesOnTheirEnds(auto, arrangement)
    // the open Domain's area comes first, top left
    const home = auto.areas!.get(`area.${HOME}`)!
    for (const frame of auto.areas!.values()) {
      expect(frame.y).toBeGreaterThanOrEqual(home.y)
      if (frame.y === home.y) expect(frame.x).toBeGreaterThanOrEqual(home.x)
    }
    // pins that place nothing leave the automatic placement as it is
    expect(pinPlacement(auto, arrangement, new Map()).placement).toBe(auto)
  })

  test('a frame dragged moves its whole area; what it lands on makes room', async () => {
    const scene = composeStructure(homeBundle(), {}, whole(peerBundle()))
    const { arrangement, auto } = await laid(scene)
    const shown = pinPlacement(auto, arrangement, new Map())
    const peer = arrangement.areas!.find((area) => area.id === `area.${PEER}`)!
    const home = auto.areas!.get(`area.${HOME}`)!
    const before = auto.areas!.get(peer.id)!
    // dropped right over the open Domain's area
    const by = { x: home.x - before.x + 40, y: home.y - before.y + 40 }
    // as the canvas lets go of a frame: its boxes, its modules and its own corner moved by `by`
    const inside = new Set(peer.members)
    const moving = [
      ...peer.members,
      ...arrangement.regions
        .filter((region) => inside.has(region.members[0]!))
        .map((region) => region.id),
      peer.id,
    ]
    const dropped = new Map(shown.pins)
    for (const id of moving) {
      const pin = dropped.get(id)!
      dropped.set(id, { x: pin.x + by.x, y: pin.y + by.y })
    }
    const pins = settleDrop(shown.placement, arrangement, dropped, peer.members)
    const after = pinPlacement(auto, arrangement, pins)
    const frame = after.placement.areas!.get(peer.id)!
    expect({ x: frame.x, y: frame.y }).toEqual({ x: before.x + by.x, y: before.y + by.y })
    expect(pins.get(peer.id)).toEqual(after.pins.get(peer.id)!)
    expectFramed(after.placement, arrangement)
    expectRoutesOnTheirEnds(after.placement, arrangement)
    // and it stays so: the recorded pins lay the same placement again
    const again = pinPlacement(auto, arrangement, after.pins)
    expect(again.placement.areas).toEqual(after.placement.areas)
  })

  test('a card dragged stays in its area, which grows around it; nothing overlaps', async () => {
    const scene = composeStructure(homeBundle(), {}, whole(peerBundle()))
    const { arrangement, auto } = await laid(scene)
    const shown = pinPlacement(auto, arrangement, new Map())
    const peerFrame = auto.areas!.get(`area.${PEER}`)!
    const card = 'class.Member'
    const dropped = new Map(shown.pins)
    // dropped inside the peer's area
    dropped.set(card, { x: peerFrame.x + 30, y: peerFrame.y + 60 })
    const pins = settleDrop(shown.placement, arrangement, dropped, [card])
    const after = pinPlacement(auto, arrangement, pins)
    expect(after.placement.boxes.get(card)).toMatchObject(dropped.get(card)!)
    expectFramed(after.placement, arrangement)
  })

  test('an area never placed comes in clear of the placed ones, which stay where they were', async () => {
    const two = await laid(composeStructure(homeBundle(), {}, whole(peerBundle())))
    const moved: Pins = new Map(
      [...pinPlacement(two.auto, two.arrangement, new Map()).pins].map(([id, pin]) => [
        id,
        { x: pin.x + 300, y: pin.y - 200 },
      ]),
    )
    const three = await laid(composeStructure(homeBundle(), {}, whole(peerBundle(), thirdBundle())))
    const after = pinPlacement(three.auto, three.arrangement, moved)
    for (const id of two.arrangement.boxes.map((box) => box.id))
      expect(after.placement.boxes.get(id)).toMatchObject(moved.get(id)!)
    expectFramed(after.placement, three.arrangement)
    expectRoutesOnTheirEnds(after.placement, three.arrangement)
  })
})
