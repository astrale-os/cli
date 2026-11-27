/**
 * Where link labels sit. A label rides its own line — one with no room by it is left out —
 * and never covers a box or a region's name; labels avoid one another, and the order they are placed in depends only on the
 * scene — never on what is selected or hovered — so opening one trunk never moves another
 * trunk's label.
 */

import type { Arrangement, Trunk } from '../scene/arrange'
import type { Scene, SceneLink, SceneTone } from '../scene/types'
import type { Point, Rect } from './geometry'
import type { Placement } from './layout'
import type { TextMeasure } from './metrics'

import {
  createEdgeLabelObstacleIndex,
  type EdgeLabelObstacle,
  type EdgeLabelRequest,
  layoutEdgeLabels,
  edgeLabelKey,
  edgeLabelRect,
  edgeLabelRectsOverlap,
  OFF_PATH_LIMIT,
  placeEdgeLabel,
} from '../../schema-studio/edge-label-layout'
import { listed, HUED_TONES } from '../scene/types'
import { atRest, faintLines, nameDrawn } from './emphasis'
import { REGION_HEADER, trunkSpread } from './layout'
import {
  memberOffsets,
  offsetPolyline,
  pointAt,
  polylineLength,
  reversed,
  samplePolyline,
} from './routes'

export const LABEL_H = 16
const LABEL_PAD_X = 6
/** The restrict mark before an end's count: its glyph and the gap after it. */
export const RESTRICT_W = 13

export interface PlacedLabel extends Rect {
  /** the trunk (closed) or scene link (open member) it names */
  id: string
  text: string
  /** an end's count: `from` or `to` */
  end?: 'from' | 'to'
  /** the end restricts: its mark reads before the count, and says so on hover */
  restricts?: { role?: string }
  /** the link's constraints, read after its name */
  marks?: string
  /** the verb its link says, when it says one: the name wears its hue */
  tone?: SceneTone
  /** the lines this one name stands for, converging on one target: `id` is one of them */
  count?: number
  /** how many times its size it is drawn: a name read at every zoom, far (`spokenLabels`) */
  scale?: number
}

const membersOf = (scene: Scene, trunk: Trunk): SceneLink[] =>
  trunk.links.flatMap((id) => scene.links.find((link) => link.id === id) ?? [])

/**
 * What a closed trunk reads: its one member's name; else, as the Scene asks, how many
 * relationships it carries, or the distinct names its links say (`creates · links`), as
 * `listed` reads them. Links that say nothing add no name: a trunk of them reads empty and
 * is drawn unnamed.
 */
export function trunkLabel(scene: Scene, trunk: Trunk): string {
  if (trunk.links.length === 1) {
    return scene.links.find((link) => link.id === trunk.links[0])?.label ?? trunk.links[0]!
  }
  if (scene.trunkLabel !== 'labels') return `${trunk.links.length} relationships`
  return listed([...new Set(membersOf(scene, trunk).map((link) => link.label))].filter(Boolean))
}

/** The hue every member of a trunk says (a verb, a rule), when they all say the same one. */
function verbOf(links: readonly SceneLink[]): SceneTone | undefined {
  const tone = links[0]?.tone
  return tone && HUED_TONES.has(tone) && links.every((link) => link.tone === tone)
    ? tone
    : undefined
}

/**
 * Whether a trunk member runs against its trunk's route: the route goes from `trunk.from` to
 * `trunk.to`, and a member whose own `from` end sits at the other end is drawn backwards.
 */
export function runsBackwards(arrangement: Arrangement, trunk: Trunk, link: SceneLink): boolean {
  if (trunk.from === trunk.to) return false
  return arrangement.linkPlace.get(link.id)?.from !== trunk.from
}

/** Each member's route when its trunk opens, keyed by scene link id. */
export function memberRoutes(trunk: Trunk, route: readonly Point[]): Map<string, Point[]> {
  const offsets = memberOffsets(trunk.links.length, trunkSpread(trunk.links.length))
  return new Map(trunk.links.map((link, index) => [link, offsetPolyline(route, offsets[index]!)]))
}

/** A region header's toggle and padding around its name, as the canvas draws them. */
const REGION_NAME_INSET = 30
const REGION_NAME_PAD = 8

/**
 * What a label never covers: a box, or a region's name at its top. The rest of the header
 * band stays open, so a link running along a region's top keeps its label beside it.
 */
function boxObstacles(
  arrangement: Arrangement,
  placement: Placement,
  measure: TextMeasure,
): EdgeLabelObstacle[] {
  return [
    ...[...placement.boxes].map(([id, rect]) => ({ id, ...rect })),
    ...arrangement.regions.flatMap((region) => {
      const rect = placement.regions.get(region.id)
      if (!rect) return []
      // Letter spacing (0.02em) widens the name past its measure.
      const name = measure(region.group.label, 'regionName') * 1.03
      const width = Math.min(rect.width, REGION_NAME_INSET + name + REGION_NAME_PAD)
      return [{ id: region.id, x: rect.x, y: rect.y, width, height: REGION_HEADER }]
    }),
  ]
}

/** The line a label's constraints take, under its name: the label grows taller, not wider. */
export const MARKS_H = 12

/**
 * The room each loop keeps beside its box for its labels: closed, its name; open, its
 * members' names stacked, each with its constraints under it, as `stackedNames` draws them.
 * Layout reserves it, so a loop's label never lands on a neighbour.
 */
export function loopLabelSizes(
  scene: Scene,
  arrangement: Arrangement,
  measure: TextMeasure,
): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>()
  for (const trunk of arrangement.trunks) {
    if (trunk.from !== trunk.to) continue
    const closed = labelSize(trunkLabel(scene, trunk), measure)
    const open = membersOf(scene, trunk).map((link) =>
      labelSize(link.label, measure, link.marks?.length ? link.marks.join(' · ') : undefined),
    )
    sizes.set(trunk.id, {
      width: Math.max(closed.width, ...open.map((row) => row.width)),
      height: Math.max(
        closed.height,
        open.reduce((total, row) => total + row.height, 0),
      ),
    })
  }
  return sizes
}

/**
 * The requested labels laid out, each by its own line. The shared layout's last resort parks a
 * label right of every box, away from its line; a Scene leaves such a label out instead.
 */
function byTheirLines(requests: EdgeLabelRequest[]): Map<string, EdgeLabelObstacle | null> {
  const placements = layoutEdgeLabels(requests)
  for (const request of requests) {
    const key = edgeLabelKey(request.edgeId, request.slot)
    const rect = placements.get(key)
    if (!rect) continue
    const reach = (point: Point) =>
      Math.hypot(
        Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width),
        Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height),
      )
    if (!request.samples.some((sample) => reach(sample) <= OFF_PATH_LIMIT))
      placements.set(key, null)
  }
  return placements
}

const labelSize = (text: string, measure: TextMeasure, marks?: string) => ({
  width:
    Math.max(measure(text, 'linkLabel'), marks ? measure(marks, 'linkMarks') : 0) + LABEL_PAD_X * 2,
  height: marks ? LABEL_H + MARKS_H : LABEL_H,
})

function placed(
  placements: Map<string, EdgeLabelObstacle | null>,
  key: string,
  id: string,
  text: string,
  end?: 'from' | 'to',
): PlacedLabel | undefined {
  const rect = placements.get(key)
  if (!rect) return undefined
  return {
    id,
    text,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    ...(end ? { end } : {}),
  }
}

/**
 * Every closed trunk's label, placed together as at rest, whatever is lit — so opening one
 * trunk never moves another's — leaving out a name the rest does not draw (`nameDrawn`).
 */
export function closedLabels(
  scene: Scene,
  arrangement: Arrangement,
  placement: Placement,
  measure: TextMeasure,
): Map<string, PlacedLabel> {
  const obstacles = createEdgeLabelObstacleIndex(boxObstacles(arrangement, placement, measure))
  const requests: EdgeLabelRequest[] = []
  const texts = new Map<string, string>()
  const tones = new Map<string, SceneTone>()
  const rest = atRest(faintLines(scene, arrangement))
  for (const trunk of arrangement.trunks) {
    const route = placement.routes.get(trunk.id)
    if (!route || !nameDrawn(trunk.id, rest)) continue
    const members = membersOf(scene, trunk)
    const text = trunkLabel(scene, trunk)
    if (text === '') continue
    texts.set(trunk.id, text)
    const tone = verbOf(members)
    if (tone) tones.set(trunk.id, tone)
    requests.push({
      edgeId: trunk.id,
      slot: 0,
      samples: samplePolyline(route),
      size: labelSize(text, measure),
      obstacles,
      preferredDistance: polylineLength(route) / 2,
    })
  }
  const placements = byTheirLines(requests)
  const labels = new Map<string, PlacedLabel>()
  for (const [id, text] of texts) {
    const label = placed(placements, edgeLabelKey(id, 0), id, text)
    const tone = tones.get(id)
    if (label) labels.set(id, tone ? { ...label, tone } : label)
  }
  return labels
}

/**
 * The labels of one open trunk: each member's name, the counts at its two ends when
 * `ends` is set, and its constraints under its name when `marks` is set — of the members
 * `named` keeps (`nameDrawn`), the others taking no room. The labels already
 * `standing` are obstacles and do not move. Names that cannot each find room of their own on
 * the line stand stacked in one block on it instead; with no room for the block, a name that
 * would cover another is left out — no two names ever cover each other.
 */
export function openLabels(
  scene: Scene,
  arrangement: Arrangement,
  trunk: Trunk,
  placement: Placement,
  standing: readonly PlacedLabel[],
  measure: TextMeasure,
  ends: boolean,
  marks = ends,
  named: (id: string) => boolean = () => true,
): PlacedLabel[] {
  const route = placement.routes.get(trunk.id)
  if (!route) return []
  const others = standing
    .filter((label) => label.id !== trunk.id)
    .map((label) => ({
      id: label.id,
      x: label.x,
      y: label.y,
      width: label.width,
      height: label.height,
    }))
  const obstacles = createEdgeLabelObstacleIndex([
    ...boxObstacles(arrangement, placement, measure),
    ...others,
  ])
  const routes = memberRoutes(trunk, route)
  const links = new Map(scene.links.map((link) => [link.id, link]))
  const requests: EdgeLabelRequest[] = []
  const texts = new Map<
    string,
    {
      id: string
      text: string
      end?: 'from' | 'to'
      marks?: string
      tone?: SceneTone
      restricts?: PlacedLabel['restricts']
    }
  >()
  const ordered = [...trunk.links].sort()
  ordered.forEach((id, index) => {
    const link = links.get(id)
    const points = routes.get(id)
    if (!link || !points) return
    const length = polylineLength(points)
    const samples = samplePolyline(points)
    if (link.label === '' || !named(id)) return
    const constraints =
      marks && link.marks && link.marks.length > 0 ? link.marks.join(' · ') : undefined
    const size = labelSize(link.label, measure, constraints)
    const tone = verbOf([link])
    texts.set(edgeLabelKey(id, 0), {
      id,
      text: link.label,
      ...(constraints ? { marks: constraints } : {}),
      ...(tone ? { tone } : {}),
    })
    requests.push({
      edgeId: id,
      slot: 0,
      samples,
      size,
      obstacles,
      // Members spread along the line so stacked names stay readable.
      preferredDistance: (length * (index + 1)) / (ordered.length + 1),
    })
    if (!ends) return
    // A member drawn against the trunk's direction has its ends the other way round.
    const flipped = runsBackwards(arrangement, trunk, link)
    for (const [slot, end] of [
      [1, 'from'],
      [2, 'to'],
    ] as const) {
      const { count = '', restricts, role } = link[end]
      if (!count && !restricts) continue
      const atStart = (end === 'from') !== flipped
      const size = labelSize(count, measure)
      texts.set(edgeLabelKey(id, slot), {
        id,
        text: count,
        end,
        ...(restricts ? { restricts: role ? { role } : {} } : {}),
      })
      requests.push({
        edgeId: id,
        slot,
        samples: atStart ? samples : samplePolyline(reversed(points)),
        size: restricts
          ? { ...size, width: size.width + (count ? RESTRICT_W : RESTRICT_W - 4) }
          : size,
        obstacles,
        preferredDistance: 16,
        maxPathDistance: Math.min(72, length / 2),
      })
    }
  })
  const placements = byTheirLines(requests)
  const result = [...texts].flatMap(([key, { id, text, end, marks, tone, restricts }]) => {
    const label = placed(placements, key, id, text, end)
    return label
      ? [
          {
            ...label,
            ...(marks ? { marks } : {}),
            ...(tone ? { tone } : {}),
            ...(restricts ? { restricts } : {}),
          },
        ]
      : []
  })
  const names = result.filter((label) => !label.end)
  const counts = result.filter((label) => label.end)
  const crowded = names.some((label, index) =>
    names.slice(index + 1).some((other) => edgeLabelRectsOverlap(label, other)),
  )
  // With no room on the line for the block either, a name that would cover another is left out.
  const shown = !crowded
    ? names
    : (stackedNames(ordered, texts, route, obstacles, measure) ?? apart(names, []))
  // A count reads beside the names, never over one: with no room of its own, it is left out.
  return [...shown, ...apart(counts, [...shown, ...others])]
}

/** The labels, in order, that cover nothing in `standing` and none kept before them. */
function apart(labels: readonly PlacedLabel[], standing: readonly Rect[]): PlacedLabel[] {
  const kept: PlacedLabel[] = []
  for (const label of labels)
    if (![...standing, ...kept].some((other) => edgeLabelRectsOverlap(label, other)))
      kept.push(label)
  return kept
}

/** One block on the trunk's line holding its members' names, one row each, in id order. */
function stackedNames(
  ordered: readonly string[],
  texts: ReadonlyMap<string, { id: string; text: string; marks?: string; tone?: SceneTone }>,
  route: readonly Point[],
  obstacles: EdgeLabelRequest['obstacles'],
  measure: TextMeasure,
): PlacedLabel[] | undefined {
  const rows = ordered.flatMap((id) => {
    const name = texts.get(edgeLabelKey(id, 0))
    return name ? [{ ...name, ...labelSize(name.text, measure, name.marks) }] : []
  })
  const size = {
    width: Math.max(...rows.map((row) => row.width)),
    height: rows.reduce((total, row) => total + row.height, 0),
  }
  const block = byTheirLines([
    {
      edgeId: 'stack',
      slot: 0,
      samples: samplePolyline(route),
      size,
      obstacles,
      preferredDistance: polylineLength(route) / 2,
    },
  ]).get(edgeLabelKey('stack', 0))
  if (!block) return undefined
  let y = block.y
  return rows.map(({ id, text, marks, tone, height }) => {
    const label = {
      id,
      text,
      x: block.x,
      y,
      width: size.width,
      height,
      ...(marks ? { marks } : {}),
      ...(tone ? { tone } : {}),
    }
    y += height
    return label
  })
}

/** How near two ends of curves are to crowd one another's names. */
const CROWD = 24

/** How far a curve's label may stand from its line, at most: any farther, it would name another. */
const NEAR_LINE = 16

/** The gap between a shared name and the count of the lines it names. */
const COUNT_GAP = 4

/** A curve drawn alone and named. */
interface NamedCurve {
  link: SceneLink
  points: Point[]
}

/**
 * The names of links drawn alone, as curves: one label per line at most, never a part of it
 * standing apart. Lines that say one name into one target — a function's `moves state` into
 * Host — share one label near the target, with the count of lines it names; what each carries
 * is read in the Inspector. A line under the pointer (`first`) reads on its own, before the
 * rest: its name, with what it carries under it where `marked` asks and there is room. A line
 * named alone reads its name near whichever end fewer other named lines meet — the targets of
 * one function's lines, the rows of the lines that reach one Class — and, when both ends are
 * as crowded, near its start if it leaves a row, else at its middle; what it carries under its
 * name when it fits there, else only its name.
 *
 * Every label stands within `NEAR_LINE` of its own line and clear of every box and every
 * other label; one with no such room is left out. Labels are placed in scene order, the lines
 * in `first` before the rest, whatever is lit.
 */
export function curveLabels(
  scene: Scene,
  arrangement: Arrangement,
  placement: Placement,
  curves: ReadonlyMap<string, Point[]>,
  leavesRow: ReadonlySet<string>,
  measure: TextMeasure,
  marked: (id: string) => boolean,
  first: ReadonlySet<string> = new Set(),
): PlacedLabel[] {
  const boxes = createEdgeLabelObstacleIndex(boxObstacles(arrangement, placement, measure))
  const standing: EdgeLabelObstacle[] = []
  /** The label's rect on its line, clear of everything standing, or none. */
  const stand = (
    key: string,
    points: readonly Point[],
    size: { width: number; height: number },
    preferredDistance: number,
  ): EdgeLabelObstacle | undefined => {
    const point = placeEdgeLabel(samplePolyline(points), size, boxes, {
      preferredDistance,
      additionalObstacles: standing,
      offPathLimit: NEAR_LINE,
    })
    if (!point) return undefined
    const rect = { id: key, ...edgeLabelRect(point, size) }
    standing.push(rect)
    return rect
  }
  const named: NamedCurve[] = scene.links.flatMap((link) => {
    const points = curves.get(link.id)
    return points && link.label !== '' ? [{ link, points }] : []
  })
  const ends = named.flatMap(({ points }) => [points[0]!, points.at(-1)!])
  // The other named lines' ends near this one, its own other end aside.
  const crowd = (end: Point) =>
    ends.filter((other) => Math.hypot(other.x - end.x, other.y - end.y) < CROWD).length - 1
  const carriedBy = (link: SceneLink) =>
    marked(link.id) && link.marks && link.marks.length > 0 ? link.marks.join(' · ') : undefined

  const groups = new Map<string, NamedCurve[]>()
  for (const curve of named) {
    const { link } = curve
    const key = first.has(link.id)
      ? link.id
      : [link.to.nodes.join(','), link.tone ?? '', link.label].join('\u0000')
    const group = groups.get(key)
    if (group) group.push(curve)
    else groups.set(key, [curve])
  }
  const order = [...groups.values()].sort(
    (a, b) => Number(first.has(b[0]!.link.id)) - Number(first.has(a[0]!.link.id)),
  )

  const result: PlacedLabel[] = []
  for (const group of order) {
    const { link } = group[0]!
    const tone = verbOf([link])
    if (group.length === 1) {
      const { points } = group[0]!
      const carried = carriedBy(link)
      const length = polylineLength(points)
      const [start, end] = [crowd(points[0]!), crowd(points.at(-1)!)]
      const along = (width: number) => {
        const reach = Math.min(length / 2, width / 2 + 14)
        return start > end
          ? length - reach
          : start < end || leavesRow.has(link.id)
            ? reach
            : length / 2
      }
      const full = labelSize(link.label, measure, carried)
      const both = carried ? stand(link.id, points, full, along(full.width)) : undefined
      const bare = labelSize(link.label, measure)
      const rect = both ?? stand(link.id, points, bare, along(bare.width))
      if (!rect) continue
      result.push({
        id: link.id,
        text: link.label,
        ...rectOf(rect),
        ...(both ? { marks: carried } : {}),
        ...(tone ? { tone } : {}),
      })
      continue
    }
    // One name near the target, on whichever member's line finds room nearest the middle of
    // where they all arrive.
    const size = {
      width:
        measure(link.label, 'linkLabel') +
        COUNT_GAP +
        measure(String(group.length), 'linkLabel') +
        LABEL_PAD_X * 2,
      height: LABEL_H,
    }
    const arrival = {
      x: group.reduce((total, { points }) => total + points.at(-1)!.x, 0) / group.length,
      y: group.reduce((total, { points }) => total + points.at(-1)!.y, 0) / group.length,
    }
    const nearest = [...group].sort((a, b) => {
      const away = (curve: NamedCurve) =>
        Math.hypot(curve.points.at(-1)!.x - arrival.x, curve.points.at(-1)!.y - arrival.y)
      return away(a) - away(b)
    })
    for (const { link: member, points } of nearest) {
      const length = polylineLength(points)
      const rect = stand(
        member.id,
        points,
        size,
        length - Math.min(length / 2, size.width / 2 + 14),
      )
      if (!rect) continue
      result.push({
        id: member.id,
        text: link.label,
        count: group.length,
        ...rectOf(rect),
        ...(tone ? { tone } : {}),
      })
      break
    }
  }
  return result
}

/**
 * The names read at every zoom, far, where no other name is drawn: the link selected and those a
 * walk steps through, each on its own line (`lines`, in the order given). Each is drawn `scale`
 * times its size, so it reads, and stands on its line clear of every box and of the names placed
 * before it; with no such room it stands at its line's middle all the same — what the reader
 * selected always says its name.
 */
export function spokenLabels(
  scene: Scene,
  arrangement: Arrangement,
  placement: Placement,
  lines: ReadonlyMap<string, readonly Point[]>,
  measure: TextMeasure,
  scale: number,
): PlacedLabel[] {
  const boxes = createEdgeLabelObstacleIndex(boxObstacles(arrangement, placement, measure))
  const standing: EdgeLabelObstacle[] = []
  const links = new Map(scene.links.map((link) => [link.id, link]))
  return [...lines].flatMap(([id, points]) => {
    const link = links.get(id)
    const length = polylineLength(points)
    if (!link || link.label === '' || length === 0) return []
    const own = labelSize(link.label, measure)
    const size = { width: own.width * scale, height: own.height * scale }
    const point =
      placeEdgeLabel(samplePolyline(points), size, boxes, {
        preferredDistance: length / 2,
        additionalObstacles: standing,
        offPathLimit: NEAR_LINE * scale,
      }) ?? pointAt(points, length / 2)
    const rect = { id, ...edgeLabelRect(point, size) }
    standing.push(rect)
    const tone = verbOf([link])
    return [{ id, text: link.label, ...rectOf(rect), scale, ...(tone ? { tone } : {}) }]
  })
}

const rectOf = (rect: Rect): Rect => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
})
