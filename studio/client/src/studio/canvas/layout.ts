/**
 * Where every box goes: an Arrangement and its box sizes in, positions and routes out.
 *
 * ELK's layered algorithm places boxes left to right along their links — or top to bottom,
 * for a Scene that leads them either way and lays out squarer so — with each
 * expanded group as a compound region and orthogonal routes in root coordinates. Trunks
 * and fans are both laid out, so a junction sits between the links that meet it and the
 * boxes it accepts; a fan is then drawn as a spoke from the junction to its box wherever
 * no other box is in the way, so a junction reads as one point fanning out. A region's
 * lines cross its border one way, so it is never routed around. Hovering or
 * selecting never moves anything. A loop reserves room for its label beside its box. The
 * engine is injected — the browser's runs in a worker — and the same input always lays
 * out the same way. A Scene of ribbons is laid out in its columns instead (`columns.ts`); a
 * Scene of several Domains, one area at a time, the areas then packed (`areas.ts`).
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js'

import { type Area, type Arrangement, type Box, isJunction } from '../scene/arrange'
import { AREA_GAP, areaFrame, areaOfBoxes, EMPTY_AREA, packAreas, withinArea } from './areas'
import { bandHeadings, columnBoxes } from './columns'
import { nearestRoom, type Point, type Rect, union } from './geometry'
import { type BoxModel, boxModel, type Detail, type TextMeasure } from './metrics'
import { routeLines } from './reroute'
import { spoke } from './routes'

export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>
}

export interface Placement {
  /** the arrangement key and detail it was laid out for */
  key: string
  detail: Detail
  boxes: ReadonlyMap<string, Rect>
  models: ReadonlyMap<string, BoxModel>
  regions: ReadonlyMap<string, Rect>
  /**
   * trunk id → its route, from the trunk's `from` end to its `to` end; fan id → its route,
   * in the fan's direction. A route meets a junction at its centre.
   */
  routes: ReadonlyMap<string, Point[]>
  /** area id → its frame, on a canvas of several Domains */
  areas?: ReadonlyMap<string, Rect>
  bounds: Rect
}

export const REGION_HEADER = 30
export const REGION_PAD = 14
/** The room a region keeps above its members, for its name. */
export const REGION_TOP = REGION_HEADER + 8
/** Gap between the members of an open trunk. */
export const TRUNK_SPREAD = 6
/**
 * The most room an open trunk takes across. A trunk of more members than fit at the full
 * gap — a collapsed module's lines to one Class — runs them closer instead of widening.
 */
export const TRUNK_ROOM = TRUNK_SPREAD * 7

/** The gap between an open trunk's members: the full one, narrower once they fill the room. */
export function trunkSpread(members: number): number {
  return members > 1 ? Math.min(TRUNK_SPREAD, TRUNK_ROOM / (members - 1)) : TRUNK_SPREAD
}
/** The least sideways gap between a junction and a box for a spoke to reach it. */
const SPOKE_CLEARANCE = 16

const ROOT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.json.edgeCoords': 'ROOT',
  'elk.json.shapeCoords': 'ROOT',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.layered.spacing.edgeNodeBetweenLayers': '28',
  'elk.spacing.nodeNode': '36',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '14',
  'elk.spacing.componentComponent': '72',
  'elk.separateConnectedComponents': 'true',
  'elk.aspectRatio': '1.7',
  'elk.padding': '[top=24,left=24,bottom=24,right=24]',
}

/** Which way a layout leads its links: left to right, or top to bottom. */
export type Lead = 'across' | 'down'

// Laid down, a line's name sits beside it, not between the layers it joins: they keep the room
// a name stands in and the line's bends. Each layer is centred on what it joins, so the stack is
// about as wide as its widest layer.
const DOWN_OPTIONS: Record<string, string> = {
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
}

// A region is laid out as part of the root's hierarchy: it states its padding and nothing
// the root decides.
const REGION_OPTIONS: Record<string, string> = {
  'elk.padding': `[top=${REGION_TOP},left=${REGION_PAD},bottom=${REGION_PAD},right=${REGION_PAD}]`,
}

/**
 * Every box's model at one detail. The cards of one column read as a list: they take the
 * widest one's width, so their edges and counts line up down the column, and what wraps in
 * a card wraps to that width. A pill keeps its own.
 */
export function boxModels(
  arrangement: Arrangement,
  detail: Detail,
  measure: TextMeasure,
): Map<string, BoxModel> {
  const models = new Map(arrangement.boxes.map((box) => [box.id, boxModel(box, detail, measure)]))
  const pill = (box: Box) => box.kind === 'node' && box.node.shape === 'pill'
  const widest = new Map<number, number>()
  for (const box of arrangement.boxes) {
    const column = columnOf(box)
    if (column === undefined || pill(box)) continue
    widest.set(column, Math.max(widest.get(column) ?? 0, models.get(box.id)!.width))
  }
  for (const box of arrangement.boxes) {
    const column = columnOf(box)
    if (column === undefined || pill(box)) continue
    models.set(box.id, boxModel(box, detail, measure, widest.get(column)!))
  }
  return models
}

/** The column a box stands in, when the Scene ranks its nodes; a junction stands in none. */
function columnOf(box: Box): number | undefined {
  return box.kind === 'node' ? box.node.column : box.kind === 'group' ? box.column : undefined
}

/** A label's size, for the loops that reserve room for theirs. */
export type LabelSize = { width: number; height: number }

/**
 * Each box's partition, when the Scene ranks its nodes: two per column, so a junction stands
 * in the one just before the boxes it accepts, and they stay in line with their column. A
 * collapsed group stands in its first member's column.
 */
function partitionsOf(arrangement: Arrangement): Map<string, number> | undefined {
  const partitions = new Map<string, number>()
  for (const box of arrangement.boxes) {
    const column = columnOf(box)
    if (column !== undefined) partitions.set(box.id, column * 2)
  }
  if (partitions.size === 0) return undefined
  for (const box of arrangement.boxes) {
    if (box.kind !== 'junction') continue
    const accepted = box.accepts.flatMap((id) => partitions.get(id) ?? [])
    if (accepted.length > 0) partitions.set(box.id, Math.max(0, Math.min(...accepted) - 1))
  }
  return partitions
}

export function elkGraph(
  arrangement: Arrangement,
  models: ReadonlyMap<string, BoxModel>,
  loopLabels: ReadonlyMap<string, LabelSize> = new Map(),
  lead: Lead = 'across',
): ElkNode {
  // A Scene that ranks its nodes is laid out in its columns: every box keeps left of any in a
  // higher one, a module in the first column any member stands in.
  const partitions = partitionsOf(arrangement)
  const partition = (index: number | undefined) =>
    index === undefined ? undefined : { 'elk.partitioning.partition': String(index) }
  const trunks = new Map(arrangement.trunks.map((trunk) => [trunk.id, trunk]))
  const against = againstFlow(arrangement)
  const edges = routeEnds(arrangement).map(([id, from, to]): ElkExtendedEdge => {
    const [source, target] = against.has(id) ? [to, from] : [from, to]
    const trunk = trunks.get(id)
    if (!trunk) return { id, sources: [source], targets: [target] }
    const label = from === to ? loopLabels.get(id) : undefined
    return {
      id,
      sources: [source],
      targets: [target],
      layoutOptions: {
        'elk.edge.thickness': String(
          1.5 + trunkSpread(trunk.links.length) * (trunk.links.length - 1),
        ),
      },
      // A loop's label takes room beside its box, so no neighbour is placed over it.
      ...(label ? { labels: [{ id: `${id}:label`, ...label }] } : {}),
    }
  })
  // The first column starts on one line. A box nothing leads into takes the first layer —
  // inside a region too, where the layering would draw it toward what it reaches — and
  // every box and region of the column keeps to its layer's left edge; a box another one
  // leads into stands after it, within the column.
  const first = partitions ? Math.min(...partitions.values()) : undefined
  const led = new Set(
    edges.flatMap((edge) => (edge.sources[0] === edge.targets[0] ? [] : [edge.targets[0]!])),
  )
  const opening = (index: number | undefined) =>
    index !== undefined && index === first ? { 'elk.alignment': 'LEFT' } : undefined
  const leaf = (id: string): ElkNode => {
    const index = partitions?.get(id)
    const options = {
      ...partition(index),
      ...opening(index),
      ...(opening(index) && !led.has(id)
        ? { 'elk.layered.layering.layerConstraint': 'FIRST' }
        : {}),
    }
    return {
      id,
      width: models.get(id)!.width,
      height: models.get(id)!.height,
      ...(Object.keys(options).length > 0 ? { layoutOptions: options } : {}),
    }
  }
  const inRegion = new Set(arrangement.regions.flatMap((region) => region.members))
  const children: ElkNode[] = []
  for (const region of arrangement.regions) {
    const ranked = region.members.flatMap((id) => partitions?.get(id) ?? [])
    const index = ranked.length > 0 ? Math.min(...ranked) : undefined
    children.push({
      id: region.id,
      layoutOptions: { ...REGION_OPTIONS, ...partition(index), ...opening(index) },
      children: region.members.map(leaf),
    })
  }
  // Region-less boxes follow in arrangement order, so the model order stays stable.
  for (const box of arrangement.boxes) if (!inRegion.has(box.id)) children.push(leaf(box.id))
  const root = lead === 'down' ? { ...ROOT_OPTIONS, ...DOWN_OPTIONS } : ROOT_OPTIONS
  return {
    id: 'root',
    // Compacting after layering would slide boxes across their columns.
    layoutOptions: partitions
      ? {
          ...root,
          'elk.partitioning.activate': 'true',
          'elk.layered.compaction.postCompaction.strategy': 'NONE',
        }
      : root,
    children,
    edges,
  }
}

/**
 * The lines laid out against their direction. A region's lines cross its border one way —
 * out of it, or into it, whichever most of them already do — so the region sits wholly
 * upstream or downstream of its neighbours instead of being routed around. Only the layout
 * reads them reversed: every route is read back in its own direction.
 */
function againstFlow(arrangement: Arrangement): Set<string> {
  const lines = routeEnds(arrangement)
  const against = new Set<string>()
  for (const region of arrangement.regions) {
    const inside = new Set(region.members)
    const leaving = lines.filter(([, from, to]) => inside.has(from) && !inside.has(to))
    const entering = lines.filter(([, from, to]) => inside.has(to) && !inside.has(from))
    const minority =
      leaving.length > entering.length ? entering : entering.length > leaving.length ? leaving : []
    for (const [id] of minority) against.add(id)
  }
  return against
}

/** The smallest rectangle holding every box and every route. */
export function boundsOf(rects: Iterable<Rect>, routes: Iterable<readonly Point[]> = []): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  for (const route of routes) {
    for (const point of route) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Straight route between two boxes' facing sides; a loop leaves and re-enters the right side. */
function directRoute(from: Rect, to: Rect): Point[] {
  if (from === to) {
    const x = from.x + from.width
    const y = from.y + Math.min(from.height / 2, 20)
    return [
      { x, y: y - 8 },
      { x: x + 24, y: y - 8 },
      { x: x + 24, y: y + 8 },
      { x, y: y + 8 },
    ]
  }
  const fromCentre = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCentre = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const rightward = toCentre.x >= fromCentre.x
  return [
    { x: rightward ? from.x + from.width : from.x, y: fromCentre.y },
    { x: rightward ? to.x : to.x + to.width, y: toCentre.y },
  ]
}

/** Every laid-out line and the boxes it runs between: trunks, then fans, each its own way. */
export function routeEnds(arrangement: Arrangement): [id: string, from: string, to: string][] {
  return [
    ...arrangement.trunks.map((trunk): [string, string, string] => [
      trunk.id,
      trunk.from,
      trunk.to,
    ]),
    ...arrangement.fans.map((fan): [string, string, string] =>
      fan.inward ? [fan.id, fan.box, fan.junction] : [fan.id, fan.junction, fan.box],
    ),
  ]
}

/**
 * Moves a route's end onto a junction's centre line: every line that meets a junction
 * meets it at one point. The first (or last) segment moves with the end, so an orthogonal
 * route stays orthogonal.
 */
function meetJunctions(
  route: Point[],
  from: string,
  fromRect: Rect,
  to: string,
  toRect: Rect,
): Point[] {
  const points = route.map((point) => ({ ...point }))
  const snap = (end: number, next: number, rect: Rect) => {
    const a = points[end]!
    const b = points[next]
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    if (!b) return
    if (Math.abs(a.y - b.y) < 0.5) {
      a.y = cy
      b.y = cy
    } else if (Math.abs(a.x - b.x) < 0.5) {
      a.x = cx
      b.x = cx
    }
  }
  if (from !== to && isJunction(from) && points.length >= 2) snap(0, 1, fromRect)
  if (from !== to && isJunction(to) && points.length >= 2)
    snap(points.length - 1, points.length - 2, toRect)
  return points
}

/** A box's rectangle shrunk by `inset` on every side. */
const inner = (rect: Rect, inset: number) => ({
  x: rect.x + inset,
  y: rect.y + inset,
  width: rect.width - inset * 2,
  height: rect.height - inset * 2,
})

const holds = (rect: Rect, point: Point) =>
  point.x > rect.x &&
  point.x < rect.x + rect.width &&
  point.y > rect.y &&
  point.y < rect.y + rect.height

/**
 * The spoke from a junction to a box it accepts, when the box stands clear of the junction
 * sideways and the spoke crosses no other box; otherwise the fan keeps its laid-out route.
 */
export function spokeOf(junction: string, box: string, boxes: ReadonlyMap<string, Rect>) {
  const hub = boxes.get(junction)
  const target = boxes.get(box)
  if (!hub || !target) return undefined
  const centre = { x: hub.x + hub.width / 2, y: hub.y + hub.height / 2 }
  if (centre.x > target.x - SPOKE_CLEARANCE && centre.x < target.x + target.width + SPOKE_CLEARANCE)
    return undefined
  const route = spoke(centre, target)
  for (const [id, rect] of boxes) {
    if (id === junction || id === box) continue
    const body = inner(rect, 2)
    if (route.some((point) => holds(body, point))) return undefined
  }
  return route
}

export function readPlacement(
  arrangement: Arrangement,
  models: ReadonlyMap<string, BoxModel>,
  result: ElkNode,
  detail: Detail,
): Placement {
  const boxes = new Map<string, Rect>()
  const regions = new Map<string, Rect>()
  const regionIds = new Set(arrangement.regions.map((region) => region.id))
  const visit = (node: ElkNode) => {
    const rect = {
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 0,
      height: node.height ?? 0,
    }
    if (regionIds.has(node.id)) regions.set(node.id, rect)
    else if (models.has(node.id)) boxes.set(node.id, rect)
    for (const child of node.children ?? []) visit(child)
  }
  for (const child of result.children ?? []) visit(child)

  const routes = new Map<string, Point[]>()
  const edges = new Map((result.edges ?? []).map((edge) => [edge.id, edge]))
  for (const fan of arrangement.fans) {
    const route = spokeOf(fan.junction, fan.box, boxes)
    if (route) routes.set(fan.id, fan.inward ? route.reverse() : route)
  }
  for (const [id, from, to] of routeEnds(arrangement)) {
    if (routes.has(id)) continue
    const edge = edges.get(id)
    const section = edge?.sections?.[0]
    const laid = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(({ x, y }) => ({
          x,
          y,
        }))
      : undefined
    // A line laid out against its direction is read back in its own.
    const points = laid && from !== to && edge?.sources[0] === to ? laid.reverse() : laid
    const fromRect = boxes.get(from)
    const toRect = boxes.get(to)
    if (!fromRect || !toRect) continue
    const route =
      points && points.length >= 2 ? points : directRoute(fromRect, from === to ? fromRect : toRect)
    routes.set(id, meetJunctions(route, from, fromRect, to, toRect))
  }
  return {
    key: arrangement.key,
    detail,
    boxes,
    models,
    regions,
    routes,
    bounds: boundsOf([...boxes.values(), ...regions.values()], routes.values()),
  }
}

/**
 * The placement the canvas falls back to when the engine fails: boxes in rows, grouped,
 * links drawn straight. Never as good, always something.
 */
export function gridPlacement(
  arrangement: Arrangement,
  models: ReadonlyMap<string, BoxModel>,
  detail: Detail,
): Placement {
  const boxes = new Map<string, Rect>()
  const columns = Math.max(1, Math.ceil(Math.sqrt(arrangement.boxes.length)))
  let x = 0
  let y = 0
  let rowHeight = 0
  arrangement.boxes.forEach((box, index) => {
    const model = models.get(box.id)!
    if (index > 0 && index % columns === 0) {
      x = 0
      y += rowHeight + 48
      rowHeight = 0
    }
    boxes.set(box.id, { x, y, width: model.width, height: model.height })
    x += model.width + 64
    rowHeight = Math.max(rowHeight, model.height)
  })
  const routes = new Map<string, Point[]>()
  for (const [id, from, to] of routeEnds(arrangement)) {
    const fromRect = boxes.get(from)
    const toRect = boxes.get(to)
    if (fromRect && toRect) routes.set(id, directRoute(fromRect, toRect))
  }
  return {
    key: arrangement.key,
    detail,
    boxes,
    models,
    regions: new Map(),
    routes,
    bounds: boundsOf(boxes.values(), routes.values()),
  }
}

/**
 * A Scene of ribbons laid out in its columns: no routes but a junction's fans, each a spoke
 * to its box; a module of boxes framed around its members; the bands' headings kept in view.
 */
export function columnPlacement(
  arrangement: Arrangement,
  models: ReadonlyMap<string, BoxModel>,
  detail: Detail,
): Placement {
  const boxes = columnBoxes(arrangement, models)
  const regions = new Map<string, Rect>()
  for (const region of arrangement.regions) {
    const frame = union(region.members.flatMap((id) => boxes.get(id) ?? []))
    if (!frame) continue
    regions.set(region.id, {
      x: frame.x - REGION_PAD,
      y: frame.y - REGION_TOP,
      width: frame.width + REGION_PAD * 2,
      height: frame.height + REGION_TOP + REGION_PAD,
    })
  }
  const routes = new Map<string, Point[]>()
  for (const fan of arrangement.fans) {
    const hub = boxes.get(fan.junction)
    const target = boxes.get(fan.box)
    if (!hub || !target) continue
    const route = spoke({ x: hub.x + hub.width / 2, y: hub.y + hub.height / 2 }, target)
    routes.set(fan.id, fan.inward ? route.reverse() : route)
  }
  return {
    key: arrangement.key,
    detail,
    boxes,
    models,
    regions,
    routes,
    bounds: boundsOf(
      [
        ...boxes.values(),
        ...regions.values(),
        ...bandHeadings(arrangement, boxes).map((heading) => heading.rect),
      ],
      routes.values(),
    ),
  }
}

export async function layoutArrangement(
  arrangement: Arrangement,
  detail: Detail,
  measure: TextMeasure,
  engine: LayoutEngine,
  loopLabels?: ReadonlyMap<string, LabelSize>,
): Promise<Placement> {
  const models = boxModels(arrangement, detail, measure)
  if (arrangement.boxes.length === 0) return gridPlacement(arrangement, models, detail)
  if (arrangement.areas && arrangement.areas.length > 0)
    return layoutAreas(arrangement, arrangement.areas, models, detail, measure, engine, loopLabels)
  return layoutAlone(arrangement, models, detail, measure, engine, loopLabels)
}

/** One Domain's arrangement laid out. */
async function layoutAlone(
  arrangement: Arrangement,
  models: ReadonlyMap<string, BoxModel>,
  detail: Detail,
  measure: TextMeasure,
  engine: LayoutEngine,
  loopLabels?: ReadonlyMap<string, LabelSize>,
): Promise<Placement> {
  if (arrangement.lines === 'ribbons') return columnPlacement(arrangement, models, detail)
  const laid = async (lead: Lead, at: Detail) => {
    const sized = at === detail ? models : boxModels(arrangement, at, measure)
    const result = await engine.layout(elkGraph(arrangement, sized, loopLabels, lead))
    return readPlacement(arrangement, sized, result, at)
  }
  try {
    // A Scene that ranks its nodes reads its columns left to right.
    if (arrangement.flow === 'across' || partitionsOf(arrangement))
      return await laid('across', detail)
    // Either way: chosen on the compact cards, so a closer look never turns the map.
    const [across, down] = await Promise.all([laid('across', 'compact'), laid('down', 'compact')])
    const chosen = longerSide(down.bounds) < longerSide(across.bounds) ? down : across
    if (detail === 'compact') return chosen
    return await laid(chosen === down ? 'down' : 'across', detail)
  } catch {
    return gridPlacement(arrangement, models, detail)
  }
}

const longerSide = (rect: Rect) => Math.max(rect.width, rect.height)

/** The least room kept around a junction between areas. */
const JUNCTION_ROOM = 28

/**
 * A Scene of several Domains: each area laid out alone, the areas packed in Scene order, the
 * junctions between areas placed among the boxes they join, clear of every frame, and the
 * lines between areas routed around every box.
 */
async function layoutAreas(
  arrangement: Arrangement,
  areas: readonly Area[],
  models: ReadonlyMap<string, BoxModel>,
  detail: Detail,
  measure: TextMeasure,
  engine: LayoutEngine,
  loopLabels?: ReadonlyMap<string, LabelSize>,
): Promise<Placement> {
  const parts = await Promise.all(
    areas.map((area) => {
      const alone = withinArea(arrangement, area)
      return alone.boxes.length === 0
        ? undefined
        : layoutAlone(alone, models, detail, measure, engine, loopLabels)
    }),
  )
  const frames = parts.map(
    (part) =>
      (part && areaFrame([...part.boxes.values(), ...part.regions.values()])) ?? {
        x: 0,
        y: 0,
        ...EMPTY_AREA,
      },
  )
  const corners = packAreas(frames, AREA_GAP)
  const boxes = new Map<string, Rect>()
  const regions = new Map<string, Rect>()
  const routes = new Map<string, Point[]>()
  const areaRects = new Map<string, Rect>()
  areas.forEach((area, index) => {
    const frame = frames[index]!
    const by = { x: corners[index]!.x - frame.x, y: corners[index]!.y - frame.y }
    const move = (rect: Rect): Rect => ({ ...rect, x: rect.x + by.x, y: rect.y + by.y })
    areaRects.set(area.id, move(frame))
    const part = parts[index]
    if (!part) return
    for (const [id, rect] of part.boxes) boxes.set(id, move(rect))
    for (const [id, rect] of part.regions) regions.set(id, move(rect))
    for (const [id, route] of part.routes)
      routes.set(
        id,
        route.map((point) => ({ x: point.x + by.x, y: point.y + by.y })),
      )
  })

  // A junction between areas stands among the boxes it joins, clear of every frame.
  const inArea = areaOfBoxes(arrangement)
  const between = arrangement.boxes.filter((box) => !inArea.has(box.id))
  const taken: Rect[] = [...areaRects.values()]
  for (const box of between) {
    const model = models.get(box.id)!
    const joined = box.kind === 'junction' ? box.accepts.flatMap((id) => boxes.get(id) ?? []) : []
    const at = union(joined)
    const rect = {
      x: (at ? at.x + at.width / 2 : 0) - model.width / 2,
      y: (at ? at.y + at.height / 2 : 0) - model.height / 2,
      width: model.width,
      height: model.height,
    }
    const room = nearestRoom(rect, taken, JUNCTION_ROOM)
    const placed = { ...rect, x: rect.x + room.x, y: rect.y + room.y }
    boxes.set(box.id, placed)
    taken.push(placed)
  }

  const fans = new Map(arrangement.fans.map((fan) => [fan.id, fan]))
  const crossing = routeEnds(arrangement).filter(([id]) => !routes.has(id))
  const again: { id: string; from: string; to: string }[] = []
  for (const [id, from, to] of crossing) {
    const fan = fans.get(id)
    const route = fan ? spokeOf(fan.junction, fan.box, boxes) : undefined
    if (fan && route) routes.set(id, fan.inward ? route.reverse() : route)
    else again.push({ id, from, to })
  }
  for (const [id, route] of routeLines(again, boxes)) routes.set(id, route)

  return {
    key: arrangement.key,
    detail,
    boxes,
    models,
    regions,
    routes,
    areas: areaRects,
    bounds: boundsOf(
      [...boxes.values(), ...regions.values(), ...areaRects.values()],
      routes.values(),
    ),
  }
}
