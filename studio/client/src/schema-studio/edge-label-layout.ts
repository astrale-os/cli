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
}

const DEFAULT_CLEARANCE = 4
const OFF_PATH_STEP = 8
const OFF_PATH_LIMIT = 256
const OBSTACLE_CELL_SIZE = 128

const cellKey = (column: number, row: number) => `${column}:${row}`

export function createEdgeLabelObstacleIndex(
  obstacles: EdgeLabelObstacle[],
  cellSize = OBSTACLE_CELL_SIZE,
): EdgeLabelObstacleIndex {
  const cells = new Map<string, EdgeLabelObstacle[]>()
  let maxRight = Number.NEGATIVE_INFINITY

  for (const obstacle of obstacles) {
    maxRight = Math.max(maxRight, obstacle.x + obstacle.width)
    const firstColumn = Math.floor(obstacle.x / cellSize)
    const lastColumn = Math.floor((obstacle.x + obstacle.width) / cellSize)
    const firstRow = Math.floor(obstacle.y / cellSize)
    const lastRow = Math.floor((obstacle.y + obstacle.height) / cellSize)
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      for (let row = firstRow; row <= lastRow; row += 1) {
        const key = cellKey(column, row)
        const entries = cells.get(key)
        if (entries) entries.push(obstacle)
        else cells.set(key, [obstacle])
      }
    }
  }

  return {
    cellSize,
    cells,
    maxRight,
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

function isFree(
  point: EdgeLabelPoint,
  size: EdgeLabelSize,
  obstacles: EdgeLabelObstacleSource,
  additionalObstacles: EdgeLabelObstacle[],
  clearance: number,
): boolean {
  const candidate = edgeLabelRect(point, size, clearance)
  if (Array.isArray(obstacles)) {
    if (obstacles.some((obstacle) => edgeLabelRectsOverlap(candidate, obstacle))) return false
  } else {
    const firstColumn = Math.floor(candidate.x / obstacles.cellSize)
    const lastColumn = Math.floor((candidate.x + candidate.width) / obstacles.cellSize)
    const firstRow = Math.floor(candidate.y / obstacles.cellSize)
    const lastRow = Math.floor((candidate.y + candidate.height) / obstacles.cellSize)
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      for (let row = firstRow; row <= lastRow; row += 1) {
        const local = obstacles.cells.get(cellKey(column, row)) ?? []
        if (local.some((obstacle) => edgeLabelRectsOverlap(candidate, obstacle))) return false
      }
    }
  }
  return additionalObstacles.every((obstacle) => !edgeLabelRectsOverlap(candidate, obstacle))
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
 * Keep a label on its rendered edge whenever possible. If every point on the relevant part of the
 * path is occupied, search outwards from the preferred point; the final right-of-graph fallback is
 * geometrically guaranteed not to intersect a node, even on an unusually dense canvas.
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

  for (const { sample } of candidates) {
    if (isFree(sample, size, obstacles, additionalObstacles, clearance)) {
      return { x: sample.x, y: sample.y }
    }
  }

  const origin = candidates[0]?.sample ?? samples[0]!
  for (let radius = OFF_PATH_STEP; radius <= OFF_PATH_LIMIT; radius += OFF_PATH_STEP) {
    for (const offset of ringOffsets(radius)) {
      const candidate = { x: origin.x + offset.x, y: origin.y + offset.y }
      if (isFree(candidate, size, obstacles, additionalObstacles, clearance)) return candidate
    }
  }

  // All obstacles end strictly before this label begins, so overlap is impossible.
  const indexedRight = Array.isArray(obstacles) ? Number.NEGATIVE_INFINITY : obstacles.maxRight
  const right = [...(Array.isArray(obstacles) ? obstacles : []), ...additionalObstacles].reduce(
    (maximum, obstacle) => Math.max(maximum, obstacle.x + obstacle.width),
    Math.max(origin.x, indexedRight),
  )
  return { x: right + clearance + size.width / 2, y: origin.y }
}
