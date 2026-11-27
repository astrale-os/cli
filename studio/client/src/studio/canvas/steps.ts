import type { SceneWalkStep } from '../scene/types'
/**
 * Where a walk's steps are numbered: a step chip beside each thing the walk reads, covering no
 * name, card or other chip where the map leaves it a free place.
 */
import type { Frame } from './frame'
import type { Point, Rect } from './geometry'
import type { PlacedLabel } from './labels'

import { overlaps } from './geometry'
import { pointAt, polylineLength } from './routes'

/** A step chip's side, as `.scene-step` draws it. */
export const STEP_CHIP = 18
/** The room between a chip and the name it numbers. */
const STEP_GAP = 3
/** The room between two chips beside one thing. */
const STEP_SPACING = 2

export interface StepChip {
  id: string
  number: number
  at: Point
  /** how many times its size the chip is drawn: beside a name read at every zoom, far */
  scale: number
}

/**
 * The walk's steps, each chip beside what it numbers: a card's at its corner; a link's beside
 * its name — before it, else after it, else above or below it — or, where it has no name, along
 * its line, midway else nearer one end. Several steps beside one thing stand side by side, in
 * order. Each takes the first such place that covers no other name, card or step, else the
 * first place. The numbers are the walk's own: a step the map does not draw leaves a gap. Far,
 * where the names it numbers are drawn `scale` times their size, its chips are too.
 */
export function walkSteps(
  frame: Frame,
  labels: readonly PlacedLabel[],
  steps: readonly SceneWalkStep[],
  scale = 1,
): StepChip[] {
  const taken: Rect[] = []
  const boxes = [...frame.placement.boxes.values()]
  const side = STEP_CHIP * scale
  const pitch = side + STEP_SPACING * scale
  const beside = new Map<string, number[]>()
  for (const step of steps) {
    const numbers = beside.get(step.id)
    if (!numbers) beside.set(step.id, [step.number])
    else if (!numbers.includes(step.number)) numbers.push(step.number)
  }
  return [...beside].flatMap(([id, numbers]) => {
    const width = side + pitch * (numbers.length - 1)
    const blockAt = (at: Point): Rect => ({ ...at, width, height: side })
    const { spots, label } = spotsOf(frame, labels, id, width, side, STEP_GAP * scale)
    const free = (spot: Point) => {
      const block = blockAt(spot)
      return (
        !labels.some((other) => other !== label && overlaps(block, other)) &&
        !boxes.some((box) => overlaps(block, box)) &&
        !taken.some((other) => overlaps(block, other))
      )
    }
    const at = spots.length > 1 ? (spots.find(free) ?? spots[0]) : spots[0]
    if (!at) return []
    taken.push(blockAt(at))
    return numbers.map((number, index) => ({
      id,
      number,
      at: { x: at.x + pitch * index, y: at.y },
      scale,
    }))
  })
}

/** Where a step may be numbered, best first, and the name it numbers beside. */
function spotsOf(
  frame: Frame,
  labels: readonly PlacedLabel[],
  id: string,
  width: number,
  side: number,
  gap: number,
): { spots: Point[]; label?: PlacedLabel } {
  const { arrangement, placement } = frame
  const place = arrangement.linkPlace.get(id)
  if (!place) {
    const box = arrangement.boxOf.get(id)
    const rect = box ? placement.boxes.get(box) : undefined
    return { spots: rect ? [{ x: rect.x - side / 2, y: rect.y - side / 2 }] : [] }
  }
  const label = labels.find((each) => each.id === id && !each.end)
  if (label) {
    const middle = label.y + label.height / 2 - side / 2
    return {
      label,
      spots: [
        { x: label.x - width - gap, y: middle },
        { x: label.x + label.width + gap, y: middle },
        { x: label.x, y: label.y - side - gap },
        { x: label.x, y: label.y + label.height + gap },
      ],
    }
  }
  const route = place.trunk ? placement.routes.get(place.trunk) : undefined
  if (!route || route.length < 2) return { spots: [] }
  const length = polylineLength(route)
  return {
    spots: ALONG.map((share) => {
      const point = pointAt(route, length * share)
      return { x: point.x - width / 2, y: point.y - side / 2 }
    }),
  }
}

/** Where along an unnamed line its step may stand, as shares of its length, best first. */
const ALONG = [0.5, 0.35, 0.65, 0.2, 0.8] as const
