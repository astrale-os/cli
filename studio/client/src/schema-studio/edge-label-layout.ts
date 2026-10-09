export interface EdgeLabelPoint {
  x: number
  y: number
}

export interface EdgeLabelSize {
  width: number
  height: number
}

export interface EdgeLabelObstacle extends EdgeLabelPoint, EdgeLabelSize {
  id: string
}

export interface EdgeLabelObstacleIndex {
  cellSize: number
  cells: ReadonlyMap<string, readonly EdgeLabelObstacle[]>
  maxRight: number
}

interface MutableEdgeLabelObstacleIndex extends EdgeLabelObstacleIndex {
  cells: Map<string, EdgeLabelObstacle[]>
}

export type EdgeLabelObstacleSource = EdgeLabelObstacle[] | EdgeLabelObstacleIndex

export interface EdgePathSample extends EdgeLabelPoint {
  /** Distance from the source along the rendered path. */
  distance: number
}

export interface EdgeLabelPlacementOptions {
  /** Preferred distance from the source along the rendered path. */
  preferredDistance: number
  /** Restrict path candidates to one end of the edge (used by cardinality chips). */
  maxPathDistance?: number
  clearance?: number
  additionalObstacles?: EdgeLabelObstacle[]
  /**
   * Labels other edges already hold. Unlike cards, they may be overlapped as a last resort: a label
   * dragged far from its own line reads worse than one that partly covers a neighbour.
   */
  softObstacles?: EdgeLabelObstacleSource
}

const DEFAULT_CLEARANCE = 4
const OFF_PATH_STEP = 8
const OFF_PATH_LIMIT = 256
const OBSTACLE_CELL_SIZE = 128
/** How far a label may step off its line to clear another label before it accepts an overlap. */
const SOFT_OFF_PATH_LIMIT = 16
/** Path samples (nearest the preferred point first) that may try that short step off the line. */
const SOFT_OFF_PATH_CANDIDATES = 24
/** Once a label is off its path anyway, how much further it may go to clear other labels. */
const SOFT_DETOUR_LIMIT = 32

const cellKey = (column: number, row: number) => `${column}:${row}`

export function createEdgeLabelObstacleIndex(
  obstacles: EdgeLabelObstacle[],
  cellSize = OBSTACLE_CELL_SIZE,
): EdgeLabelObstacleIndex {
  const index: MutableEdgeLabelObstacleIndex = {
    cellSize,
    cells: new Map(),
    maxRight: Number.NEGATIVE_INFINITY,
  }
  for (const obstacle of obstacles) insertObstacle(index, obstacle)
  return index
}

function insertObstacle(index: MutableEdgeLabelObstacleIndex, obstacle: EdgeLabelObstacle) {
  index.maxRight = Math.max(index.maxRight, obstacle.x + obstacle.width)
  const firstColumn = Math.floor(obstacle.x / index.cellSize)
  const lastColumn = Math.floor((obstacle.x + obstacle.width) / index.cellSize)
  const firstRow = Math.floor(obstacle.y / index.cellSize)
  const lastRow = Math.floor((obstacle.y + obstacle.height) / index.cellSize)
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      const key = cellKey(column, row)
      const entries = index.cells.get(key)
      if (entries) entries.push(obstacle)
      else index.cells.set(key, [obstacle])
    }
  }
}

export function edgeLabelRect(
  point: EdgeLabelPoint,
  size: EdgeLabelSize,
  clearance = 0,
): Omit<EdgeLabelObstacle, 'id'> {
  return {
    x: point.x - size.width / 2 - clearance,
    y: point.y - size.height / 2 - clearance,
    width: size.width + clearance * 2,
    height: size.height + clearance * 2,
  }
}

export function edgeLabelRectsOverlap(
  left: Omit<EdgeLabelObstacle, 'id'>,
  right: Omit<EdgeLabelObstacle, 'id'>,
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

/** Every obstacle of `obstacles` the rectangle touches, each reported once. */
function overlapping(
  rect: Omit<EdgeLabelObstacle, 'id'>,
  obstacles: EdgeLabelObstacleSource,
): EdgeLabelObstacle[] {
  if (Array.isArray(obstacles)) {
    return obstacles.filter((obstacle) => edgeLabelRectsOverlap(rect, obstacle))
  }
  const hits = new Set<EdgeLabelObstacle>()
  const firstColumn = Math.floor(rect.x / obstacles.cellSize)
  const lastColumn = Math.floor((rect.x + rect.width) / obstacles.cellSize)
  const firstRow = Math.floor(rect.y / obstacles.cellSize)
  const lastRow = Math.floor((rect.y + rect.height) / obstacles.cellSize)
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (const obstacle of obstacles.cells.get(cellKey(column, row)) ?? []) {
        if (edgeLabelRectsOverlap(rect, obstacle)) hits.add(obstacle)
      }
    }
  }
  return [...hits]
}

function clearOf(rect: Omit<EdgeLabelObstacle, 'id'>, obstacles: EdgeLabelObstacleSource): boolean {
  if (Array.isArray(obstacles))
    return !obstacles.some((obstacle) => edgeLabelRectsOverlap(rect, obstacle))
  const firstColumn = Math.floor(rect.x / obstacles.cellSize)
  const lastColumn = Math.floor((rect.x + rect.width) / obstacles.cellSize)
  const firstRow = Math.floor(rect.y / obstacles.cellSize)
  const lastRow = Math.floor((rect.y + rect.height) / obstacles.cellSize)
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      const local = obstacles.cells.get(cellKey(column, row))
      if (local?.some((obstacle) => edgeLabelRectsOverlap(rect, obstacle))) return false
    }
  }
  return true
}

function overlapArea(
  rect: Omit<EdgeLabelObstacle, 'id'>,
  obstacles: EdgeLabelObstacleSource,
): number {
  return overlapping(rect, obstacles).reduce(
    (area, obstacle) =>
      area +
      Math.max(
        0,
        Math.min(rect.x + rect.width, obstacle.x + obstacle.width) - Math.max(rect.x, obstacle.x),
      ) *
        Math.max(
          0,
          Math.min(rect.y + rect.height, obstacle.y + obstacle.height) -
            Math.max(rect.y, obstacle.y),
        ),
    0,
  )
}

function finiteSamples(samples: EdgePathSample[]): EdgePathSample[] {
  return samples.filter(
    (sample) =>
      Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.distance),
  )
}

function ringOffsets(radius: number): EdgeLabelPoint[] {
  const offsets: EdgeLabelPoint[] = []
  for (let x = -radius; x <= radius; x += OFF_PATH_STEP) {
    offsets.push({ x, y: -radius }, { x, y: radius })
  }
  for (let y = -radius + OFF_PATH_STEP; y < radius; y += OFF_PATH_STEP) {
    offsets.push({ x: -radius, y }, { x: radius, y })
  }
  return offsets
}

/**
 * Keep a label on its rendered edge whenever possible. Cards (`obstacles`) and the edge's own labels
 * (`additionalObstacles`) are never covered; other edges' labels (`softObstacles`) are avoided first
 * by sliding along the path, then by a short step off it, and only then overlapped as little as
 * the path allows. If every point on the relevant part of the path is covered by a card, search
 * outwards from the preferred point; the final right-of-graph fallback is geometrically guaranteed
 * not to intersect a node, even on an unusually dense canvas.
 */
export function placeEdgeLabel(
  rawSamples: EdgePathSample[],
  size: EdgeLabelSize,
  obstacles: EdgeLabelObstacleSource,
  options: EdgeLabelPlacementOptions,
): EdgeLabelPoint | null {
  const samples = finiteSamples(rawSamples)
  if (samples.length === 0 || size.width <= 0 || size.height <= 0) return null

  const clearance = options.clearance ?? DEFAULT_CLEARANCE
  const additionalObstacles = options.additionalObstacles ?? []
  const softObstacles = options.softObstacles ?? []
  const rectAt = (point: EdgeLabelPoint) => edgeLabelRect(point, size, clearance)
  const isFree = (point: EdgeLabelPoint) => {
    const rect = rectAt(point)
    return clearOf(rect, obstacles) && clearOf(rect, additionalObstacles)
  }
  const isClear = (point: EdgeLabelPoint) => isFree(point) && clearOf(rectAt(point), softObstacles)

  const withinWindow = samples.filter(
    (sample) =>
      options.maxPathDistance === undefined ||
      Math.abs(sample.distance - options.preferredDistance) <= options.maxPathDistance,
  )
  const candidates = (withinWindow.length > 0 ? withinWindow : samples)
    .map((sample, index) => ({ sample, index }))
    .sort(
      (left, right) =>
        Math.abs(left.sample.distance - options.preferredDistance) -
          Math.abs(right.sample.distance - options.preferredDistance) || left.index - right.index,
    )
  const origin = candidates[0]?.sample ?? samples[0]!

  for (const { sample } of candidates) {
    if (isClear(sample)) return { x: sample.x, y: sample.y }
  }

  for (let radius = OFF_PATH_STEP; radius <= SOFT_OFF_PATH_LIMIT; radius += OFF_PATH_STEP) {
    for (const { sample } of candidates.slice(0, SOFT_OFF_PATH_CANDIDATES)) {
      for (const offset of ringOffsets(radius)) {
        const candidate = { x: sample.x + offset.x, y: sample.y + offset.y }
        if (isClear(candidate)) return candidate
      }
    }
  }

  let leastCovering: { point: EdgeLabelPoint; area: number } | null = null
  for (const { sample } of candidates) {
    if (!isFree(sample)) continue
    const area = overlapArea(rectAt(sample), softObstacles)
    if (!leastCovering || area < leastCovering.area) leastCovering = { point: sample, area }
  }
  if (leastCovering) return { x: leastCovering.point.x, y: leastCovering.point.y }

  // Off the path, the first card-free point wins unless a point clear of labels too lies within a
  // short detour further out.
  let firstFree: { point: EdgeLabelPoint; radius: number } | null = null
  for (let radius = OFF_PATH_STEP; radius <= OFF_PATH_LIMIT; radius += OFF_PATH_STEP) {
    if (firstFree && radius > firstFree.radius + SOFT_DETOUR_LIMIT) break
    for (const offset of ringOffsets(radius)) {
      const candidate = { x: origin.x + offset.x, y: origin.y + offset.y }
      if (!isFree(candidate)) continue
      if (clearOf(rectAt(candidate), softObstacles)) return candidate
      firstFree ??= { point: candidate, radius }
    }
  }
  if (firstFree) return firstFree.point

  // All obstacles end strictly before this label begins, so overlap is impossible.
  const indexedRight = Array.isArray(obstacles) ? Number.NEGATIVE_INFINITY : obstacles.maxRight
  const right = [...(Array.isArray(obstacles) ? obstacles : []), ...additionalObstacles].reduce(
    (maximum, obstacle) => Math.max(maximum, obstacle.x + obstacle.width),
    Math.max(origin.x, indexedRight),
  )
  return { x: right + clearance + size.width / 2, y: origin.y }
}

/** One label the canvas wants placed: an edge's name (`slot` 0) or one of its end chips. */
export interface EdgeLabelRequest {
  edgeId: string
  /** 0 = the relationship name, 1 = source chip, 2 = target chip. */
  slot: number
  samples: EdgePathSample[]
  size: EdgeLabelSize
  obstacles: EdgeLabelObstacleSource
  preferredDistance: number
  maxPathDistance?: number
}

export const edgeLabelKey = (edgeId: string, slot: number) => `${edgeId}:${slot}`

/**
 * Place every label of a canvas together, so each one steers clear of the ones placed before it.
 * The order depends only on the edges, never on selection or focus: clicking an edge must not
 * reshuffle the labels around it. Names come first (they carry the meaning), chips second.
 */
export function layoutEdgeLabels(
  requests: EdgeLabelRequest[],
): Map<string, EdgeLabelObstacle | null> {
  const ordered = [...requests].sort(
    (left, right) =>
      Number(left.slot !== 0) - Number(right.slot !== 0) ||
      (left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0) ||
      left.slot - right.slot,
  )
  const placedLabels = createEdgeLabelObstacleIndex([]) as MutableEdgeLabelObstacleIndex
  const ownLabels = new Map<string, EdgeLabelObstacle[]>()
  const placements = new Map<string, EdgeLabelObstacle | null>()

  for (const request of ordered) {
    const key = edgeLabelKey(request.edgeId, request.slot)
    const own = ownLabels.get(request.edgeId) ?? []
    const point = placeEdgeLabel(request.samples, request.size, request.obstacles, {
      preferredDistance: request.preferredDistance,
      maxPathDistance: request.maxPathDistance,
      additionalObstacles: own,
      softObstacles: placedLabels,
    })
    if (!point) {
      placements.set(key, null)
      continue
    }
    const rect = { id: key, ...edgeLabelRect(point, request.size) }
    placements.set(key, rect)
    insertObstacle(placedLabels, rect)
    ownLabels.set(request.edgeId, [...own, rect])
  }
  return placements
}
