/**
 * A state machine laid out as a diagram: each state a box, each transition an arrow. Pure
 * geometry, no rendering and nothing of the Studio's: a machine goes in (`Machine`), boxes and
 * paths in one coordinate space come out (`DiagramLayout`), sized by the metrics handed in.
 *
 * States stand in ranks, left to right, by how many transitions away from the initial state they
 * are; the states of one rank stack. Transitions between the same two states are one arrow that
 * carries every event. An arrow takes the plainest route that crosses no state:
 *
 * - `direct`: between neighbours. To the next rank or back to the one before, a curve that leaves
 *   one state's side and enters the other's, level at both ends, so it stays in the room between
 *   the two ranks; the arrows on one side of a state each take a place of their own on it, in the
 *   order of where they go. To the state just above or below, a line, bowed when the opposite
 *   arrow exists so the pair reads as two.
 * - `side`: an arc at the right of a rank, between two of its states that are not neighbours.
 * - `around`: an arch over or under the diagram, back across more than one rank.
 * - `loop`: a state to itself.
 */

/** One transition: on `event`, a thing in `from` goes to `to`. */
export interface Transition {
  readonly from: string
  readonly event: string
  readonly to: string
}

export interface Machine {
  /** where every one starts; the first state when none is declared */
  readonly initial?: string
  readonly states: readonly string[]
  readonly transitions: readonly Transition[]
}

/** The sizes a diagram is drawn with, in the unit of its coordinate space. */
export interface DiagramMetrics {
  /** a state's box: its height, the room either side of its name, a name's width per character */
  readonly stateHeight: number
  readonly statePad: number
  readonly charWidth: number
  /** the least room between two ranks, and between two states of one rank */
  readonly rankGap: number
  readonly stateGap: number
  /** event names are drawn on the arrows: ranks stand apart enough to hold them */
  readonly labels: boolean
  /** an event name's width per character, and its line height */
  readonly labelCharWidth: number
  readonly labelHeight: number
  /** an arrowhead's length */
  readonly arrow: number
  /** between two arcs that run side by side */
  readonly lane: number
  /** around the whole diagram */
  readonly margin: number
}

export type EdgeRoute = 'direct' | 'side' | 'around' | 'loop'

export interface DiagramState {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rank: number
  readonly initial: boolean
  /** no transition leaves it for another state */
  readonly final: boolean
  /** no chain of transitions reaches it from the initial state */
  readonly unreachable: boolean
}

export interface DiagramEdge {
  /** `from→to` */
  readonly id: string
  readonly from: string
  readonly to: string
  /** every event that takes `from` to `to`, in the order declared */
  readonly events: readonly string[]
  readonly route: EdgeRoute
  /** the arrow's line, as an SVG path */
  readonly path: string
  /** its head, as an SVG path: a closed triangle at `to` */
  readonly head: string
  /** where its events are written: the middle of the line, clear of it */
  readonly label: { readonly x: number; readonly y: number }
}

export interface DiagramLayout {
  readonly width: number
  readonly height: number
  readonly states: readonly DiagramState[]
  readonly edges: readonly DiagramEdge[]
  /** the mark every one starts from: a dot, and the short line from it into the initial state */
  readonly start?: {
    readonly x: number
    readonly y: number
    readonly path: string
    readonly head: string
  }
}

interface Point {
  x: number
  y: number
}

interface Box extends Point {
  id: string
  width: number
  height: number
  rank: number
  /** its place in its rank, from the top */
  row: number
}

const edgeId = (from: string, to: string) => `${from}→${to}`

/** How far from the initial state each state is; a state nothing reaches stands after every other. */
function ranksOf(machine: Machine, initial: string | undefined): Map<string, number> {
  const ranks = new Map<string, number>()
  let frontier = initial === undefined ? [] : [initial]
  for (let rank = 0; frontier.length > 0; rank++) {
    const next: string[] = []
    for (const state of frontier) {
      if (ranks.has(state)) continue
      ranks.set(state, rank)
      for (const step of machine.transitions) if (step.from === state) next.push(step.to)
    }
    frontier = next.filter((state) => !ranks.has(state))
  }
  const last = Math.max(-1, ...ranks.values()) + 1
  for (const state of machine.states) if (!ranks.has(state)) ranks.set(state, last)
  return ranks
}

/** The point where the line from a box's centre towards `towards` leaves the box, `pad` beyond it. */
function leave(box: Box, towards: Point, pad = 0): Point {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = towards.x - cx
  const dy = towards.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const halfW = box.width / 2 + pad
  const halfH = box.height / 2 + pad
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  )
  return { x: cx + dx * scale, y: cy + dy * scale }
}

const round = (value: number) => Math.round(value * 10) / 10
const at = (point: Point) => `${round(point.x)},${round(point.y)}`

/** The point a cubic curve passes at `t`, from 0 at its start to 1 at its end. */
function along(start: Point, c1: Point, c2: Point, end: Point, t: number): Point {
  const u = 1 - t
  const weigh = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
  return { x: weigh(start.x, c1.x, c2.x, end.x), y: weigh(start.y, c1.y, c2.y, end.y) }
}

/** More arrows than this between two ranks, and their names take two columns. */
const CROWDED = 6

/** A closed triangle whose tip is `tip`, pointing the way `from` → `tip` goes. */
function headAt(tip: Point, from: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const spread = 0.42
  const left = {
    x: tip.x - size * Math.cos(angle - spread),
    y: tip.y - size * Math.sin(angle - spread),
  }
  const right = {
    x: tip.x - size * Math.cos(angle + spread),
    y: tip.y - size * Math.sin(angle + spread),
  }
  return `M${at(tip)} L${at(left)} L${at(right)} Z`
}

/** The layout of `machine`, drawn with `metrics`. */
export function layoutMachine(machine: Machine, metrics: DiagramMetrics): DiagramLayout {
  const states = [...new Set(machine.states)]
  if (states.length === 0) return { width: 0, height: 0, states: [], edges: [] }
  const known = new Set(states)
  const transitions = machine.transitions.filter(
    (step) => known.has(step.from) && known.has(step.to),
  )
  const initial =
    machine.initial !== undefined && known.has(machine.initial) ? machine.initial : states[0]
  const ranks = ranksOf({ ...machine, states, transitions }, initial)
  const reached = new Set<string>()
  {
    const queue = initial === undefined ? [] : [initial]
    while (queue.length > 0) {
      const state = queue.pop()!
      if (reached.has(state)) continue
      reached.add(state)
      for (const step of transitions) if (step.from === state) queue.push(step.to)
    }
  }

  // Transitions between the same two states are one arrow.
  const merged = new Map<string, { from: string; to: string; events: string[] }>()
  for (const step of transitions) {
    const id = edgeId(step.from, step.to)
    const edge = merged.get(id) ?? { from: step.from, to: step.to, events: [] }
    if (!edge.events.includes(step.event)) edge.events.push(step.event)
    merged.set(id, edge)
  }
  const arrows = [...merged.values()]
  const loops = arrows.some((edge) => edge.from === edge.to)

  // The states of each rank, each placed by where the states it comes from stand in the rank
  // before: the arrows between two ranks cross as little as one pass can make them.
  const rankCount = Math.max(...ranks.values()) + 1
  const columns: string[][] = Array.from({ length: rankCount }, () => [])
  for (const state of states) columns[ranks.get(state)!]!.push(state)
  for (let rank = 1; rank < rankCount; rank++) {
    const before = columns[rank - 1]!
    const weight = (state: string) => {
      const from = arrows
        .filter((edge) => edge.to === state || edge.from === state)
        .map((edge) => before.indexOf(edge.to === state ? edge.from : edge.to))
        .filter((index) => index >= 0)
      return from.length === 0
        ? Infinity
        : from.reduce((sum, index) => sum + index, 0) / from.length
    }
    const order = new Map(columns[rank]!.map((state, index) => [state, index]))
    columns[rank]!.sort((a, b) => weight(a) - weight(b) || order.get(a)! - order.get(b)!)
  }

  const widthOf = (state: string) =>
    Math.max(metrics.stateHeight * 1.6, state.length * metrics.charWidth + metrics.statePad * 2)
  const labelWidth = (events: readonly string[]) =>
    Math.max(...events.map((event) => event.length)) * metrics.labelCharWidth
  // With event names drawn, states stand apart enough to hold the longest between them; a loop
  // needs the room above its state.
  const between = (rank: number) =>
    arrows.filter((edge) => {
      const a = ranks.get(edge.from)!
      const b = ranks.get(edge.to)!
      return Math.min(a, b) === rank && Math.max(a, b) === rank + 1
    })
  // Between two ranks many names are written in two columns, one towards each rank.
  const columnsOfNames = (rank: number) =>
    metrics.labels && between(rank).length > CROWDED ? 2 : 1
  const gapAfter = (rank: number) => {
    if (!metrics.labels) return metrics.rankGap
    const widest = Math.max(0, ...between(rank).map((edge) => labelWidth(edge.events)))
    const names = columnsOfNames(rank)
    return Math.max(metrics.rankGap, names * widest + (names + 1.5) * metrics.statePad * 1.5)
  }
  // States stand apart enough for a loop above each, for a name between two, and for the names
  // written between two ranks to each have a line of their own.
  const mostStates = Math.max(...columns.map((column) => column.length))
  const namesTall = metrics.labels
    ? Math.max(
        0,
        ...columns
          .slice(0, -1)
          .map(
            (_, rank) =>
              Math.ceil(between(rank).length / columnsOfNames(rank)) * metrics.labelHeight * 1.5,
          ),
      )
    : 0
  const stateGap = Math.max(
    metrics.stateGap,
    loops ? metrics.stateHeight * 0.9 : 0,
    metrics.labels ? metrics.labelHeight * 1.6 : 0,
    mostStates > 1 ? (namesTall - mostStates * metrics.stateHeight) / (mostStates - 1) : 0,
  )

  const columnWidth = columns.map((column) => Math.max(...column.map(widthOf)))
  const columnHeight = columns.map(
    (column) => column.length * metrics.stateHeight + (column.length - 1) * stateGap,
  )
  const tallest = Math.max(...columnHeight)
  const boxes = new Map<string, Box>()
  let x = 0
  columns.forEach((column, rank) => {
    let y = (tallest - columnHeight[rank]!) / 2
    column.forEach((state, row) => {
      const width = widthOf(state)
      boxes.set(state, {
        id: state,
        x: x + (columnWidth[rank]! - width) / 2,
        y,
        width,
        height: metrics.stateHeight,
        rank,
        row,
      })
      y += metrics.stateHeight + stateGap
    })
    x += columnWidth[rank]! + (rank < rankCount - 1 ? gapAfter(rank) : 0)
  })

  const centre = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  // What the diagram covers, grown by every arrow drawn outside the boxes.
  const extent = { left: 0, top: 0, right: x, bottom: tallest }
  const cover = (...points: Point[]) => {
    for (const point of points) {
      extent.left = Math.min(extent.left, point.x)
      extent.top = Math.min(extent.top, point.y)
      extent.right = Math.max(extent.right, point.x)
      extent.bottom = Math.max(extent.bottom, point.y)
    }
  }

  const routeOf = (edge: { from: string; to: string }): EdgeRoute => {
    if (edge.from === edge.to) return 'loop'
    const a = boxes.get(edge.from)!
    const b = boxes.get(edge.to)!
    if (a.rank === b.rank) return Math.abs(a.row - b.row) === 1 ? 'direct' : 'side'
    return Math.abs(a.rank - b.rank) === 1 ? 'direct' : 'around'
  }
  const routed = arrows.map((edge) => ({ ...edge, route: routeOf(edge) }))

  // Arcs that run side by side take a lane each, the shortest innermost.
  const span = (edge: { from: string; to: string }) => {
    const a = centre(boxes.get(edge.from)!)
    const b = centre(boxes.get(edge.to)!)
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  }
  const sideLanes = new Map<string, number>()
  for (let rank = 0; rank < rankCount; rank++) {
    routed
      .filter((edge) => edge.route === 'side' && boxes.get(edge.from)!.rank === rank)
      .sort((a, b) => span(a) - span(b))
      .forEach((edge, lane) => sideLanes.set(edgeId(edge.from, edge.to), lane))
  }
  const over = (edge: { from: string; to: string }) =>
    (centre(boxes.get(edge.from)!).y + centre(boxes.get(edge.to)!).y) / 2 <= tallest / 2
  const aroundLanes = new Map<string, number>()
  for (const above of [true, false]) {
    routed
      .filter((edge) => edge.route === 'around' && over(edge) === above)
      .sort((a, b) => span(a) - span(b))
      .forEach((edge, lane) => aroundLanes.set(edgeId(edge.from, edge.to), lane))
  }

  // The arrows between two ranks that meet one side of a state each take a place on it, in the
  // order of where their other end stands: they fan out and never cross at the state.
  const sides = new Map<string, { id: string; other: number; back: boolean }[]>()
  for (const edge of routed) {
    const a = boxes.get(edge.from)!
    const b = boxes.get(edge.to)!
    if (edge.route !== 'direct' || a.rank === b.rank) continue
    const back = b.rank < a.rank
    const id = edgeId(edge.from, edge.to)
    const meet = (box: Box, side: 'left' | 'right', other: Box) => {
      const key = `${box.id}|${side}`
      sides.set(key, [...(sides.get(key) ?? []), { id, other: centre(other).y, back }])
    }
    meet(a, back ? 'left' : 'right', b)
    meet(b, back ? 'right' : 'left', a)
  }
  for (const met of sides.values())
    met.sort((one, two) => one.other - two.other || Number(one.back) - Number(two.back))
  const portOf = (box: Box, side: 'left' | 'right', id: string): Point => {
    const met = sides.get(`${box.id}|${side}`) ?? []
    const index = met.findIndex((one) => one.id === id)
    const step =
      met.length > 1 ? Math.min(metrics.arrow, (box.height - metrics.arrow) / (met.length - 1)) : 0
    return {
      x: side === 'left' ? box.x : box.x + box.width,
      y: box.y + box.height / 2 + (index - (met.length - 1) / 2) * step,
    }
  }

  // Where along its curve an arrow between two ranks is named: midway, or — where the names are
  // many — a third of the way from one rank or the other, by turns down the room between them.
  const nameAt = new Map<string, number>()
  for (let rank = 0; rank < rankCount - 1; rank++) {
    if (columnsOfNames(rank) === 1) continue
    between(rank)
      .map((edge) => ({
        edge,
        y: (centre(boxes.get(edge.from)!).y + centre(boxes.get(edge.to)!).y) / 2,
      }))
      .sort((one, two) => one.y - two.y)
      .forEach(({ edge }, index) => {
        // counted from the lower rank's side, whichever way the arrow goes
        const near = index % 2 === 0 ? 0.3 : 0.7
        const back = ranks.get(edge.to)! < ranks.get(edge.from)!
        nameAt.set(edgeId(edge.from, edge.to), back ? 1 - near : near)
      })
  }

  const edges: DiagramEdge[] = routed.map((edge) => {
    const id = edgeId(edge.from, edge.to)
    const a = boxes.get(edge.from)!
    const b = boxes.get(edge.to)!
    const from = centre(a)
    const to = centre(b)
    const common = { id, from: edge.from, to: edge.to, events: edge.events, route: edge.route }

    if (edge.route === 'loop') {
      const reach = metrics.stateHeight * 0.75
      const start = { x: from.x - reach * 0.45, y: a.y }
      const end = { x: from.x + reach * 0.45, y: a.y - 1.5 }
      const c1 = { x: from.x - reach, y: a.y - reach }
      const c2 = { x: from.x + reach, y: a.y - reach }
      cover(c1, c2)
      return {
        ...common,
        path: `M${at(start)} C${at(c1)} ${at(c2)} ${at(end)}`,
        head: headAt(end, c2, metrics.arrow),
        label: { x: from.x, y: a.y - reach * 0.75 - metrics.labelHeight / 2 },
      }
    }

    if (edge.route === 'side') {
      const lane = sideLanes.get(id) ?? 0
      const out = Math.max(a.x + a.width, b.x + b.width) + metrics.lane * (lane + 1.4)
      const start = { x: a.x + a.width, y: from.y }
      const end = { x: b.x + b.width + 1.5, y: to.y }
      const c1 = { x: out, y: from.y }
      const c2 = { x: out, y: to.y }
      // A cubic reaches three quarters of the way to its control points.
      const reach = start.x + (out - start.x) * 0.75
      cover({ x: reach + 2, y: from.y }, { x: reach + 2, y: to.y })
      return {
        ...common,
        path: `M${at(start)} C${at(c1)} ${at(c2)} ${at(end)}`,
        head: headAt(end, c2, metrics.arrow),
        label: { x: reach + metrics.labelCharWidth, y: (from.y + to.y) / 2 },
      }
    }

    if (edge.route === 'around') {
      const lane = aroundLanes.get(id) ?? 0
      const above = over(edge)
      const edgeY = (box: Box) => (above ? box.y : box.y + box.height)
      // Leaving a state towards the other, entering it from the other's side: several arches on
      // one state never share a point.
      const lean = Math.sign(to.x - from.x) * Math.min(a.width, b.width) * 0.22
      const start = { x: from.x + lean, y: edgeY(a) }
      const end = { x: to.x - lean, y: edgeY(b) + (above ? -1.5 : 1.5) }
      // The arch clears every state between the two, by a lane: a cubic whose two control points
      // stand at one height passes, midway, an eighth of each end and three quarters of them.
      const clear = above ? -metrics.lane * (lane + 1.2) : tallest + metrics.lane * (lane + 1.2)
      const far = (clear - (start.y + end.y) / 8) / 0.75
      const c1 = { x: start.x, y: far }
      const c2 = { x: end.x, y: far }
      const apex = { x: (start.x + end.x) / 2, y: clear }
      cover(apex, { x: apex.x, y: clear + (above ? -metrics.labelHeight : metrics.labelHeight) })
      return {
        ...common,
        path: `M${at(start)} C${at(c1)} ${at(c2)} ${at(end)}`,
        head: headAt(end, c2, metrics.arrow),
        label: {
          x: apex.x,
          y: apex.y + ((above ? -1 : 1) * metrics.labelHeight) / 2,
        },
      }
    }

    if (a.rank !== b.rank) {
      const back = b.rank < a.rank
      const start = portOf(a, back ? 'left' : 'right', id)
      const port = portOf(b, back ? 'right' : 'left', id)
      const end = { x: port.x + (back ? 1.5 : -1.5), y: port.y }
      const reach = (end.x - start.x) / 2
      const c1 = { x: start.x + reach, y: start.y }
      const c2 = { x: end.x - reach, y: end.y }
      return {
        ...common,
        path: `M${at(start)} C${at(c1)} ${at(c2)} ${at(end)}`,
        head: headAt(end, c2, metrics.arrow),
        // on the curve itself: the name interrupts its line
        label: along(start, c1, c2, end, nameAt.get(id) ?? 0.5),
      }
    }

    // A line to the state just above or below; bowed to the left of its way when the opposite
    // arrow exists.
    const paired = merged.has(edgeId(edge.to, edge.from))
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
    const normal = { x: (to.y - from.y) / length, y: -(to.x - from.x) / length }
    const bow = paired ? Math.max(metrics.arrow * 1.6, length * 0.16) : 0
    const control = {
      x: (from.x + to.x) / 2 + normal.x * bow,
      y: (from.y + to.y) / 2 + normal.y * bow,
    }
    const start = leave(a, control)
    const end = leave(b, control, 1.5)
    const middle = {
      x: start.x / 4 + control.x / 2 + end.x / 4,
      y: start.y / 4 + control.y / 2 + end.y / 4,
    }
    // Its events stand off the line, on the side it bows to; above a line that does not bow.
    const off = metrics.labelHeight * 0.75
    const side = paired ? normal : normal.y > 0 ? { x: -normal.x, y: -normal.y } : normal
    cover(middle)
    return {
      ...common,
      path: `M${at(start)} Q${at(control)} ${at(end)}`,
      head: headAt(end, control, metrics.arrow),
      label: { x: middle.x + side.x * off, y: middle.y + side.y * off },
    }
  })

  // Every one starts at a dot left of the initial state.
  const first = initial === undefined ? undefined : boxes.get(initial)
  const lead = metrics.stateHeight * 0.8
  const dot = first ? { x: first.x - lead, y: first.y + first.height / 2 } : undefined
  if (dot) cover({ x: dot.x - metrics.arrow, y: dot.y })

  // Event names that would be written over one another move apart, a little at a time.
  const placed = edges.map((edge) => ({
    edge,
    x: edge.label.x,
    y: edge.label.y,
    halfW: labelWidth(edge.events) / 2 + 3,
    halfH: (edge.events.length * metrics.labelHeight) / 2 + 1,
  }))
  if (metrics.labels)
    for (let pass = 0; pass < 6; pass++) {
      let apart = false
      for (let i = 0; i < placed.length; i++)
        for (let j = i + 1; j < placed.length; j++) {
          const one = placed[i]!
          const two = placed[j]!
          const overX = one.halfW + two.halfW - Math.abs(one.x - two.x)
          const overY = one.halfH + two.halfH - Math.abs(one.y - two.y)
          if (overX <= 0 || overY <= 0) continue
          const push = overY / 2 + 0.5
          const up = one.y < two.y || (one.y === two.y && i < j) ? one : two
          const down = up === one ? two : one
          up.y -= push
          down.y += push
          apart = true
        }
      if (!apart) break
    }

  // Event names reach either side of where they are written.
  if (metrics.labels)
    for (const label of placed)
      cover(
        { x: label.x - label.halfW, y: label.y - label.halfH },
        { x: label.x + label.halfW, y: label.y + label.halfH },
      )

  const shiftX = metrics.margin - extent.left
  const shiftY = metrics.margin - extent.top
  const moved = (path: string) =>
    path.replace(
      /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g,
      (_, px: string, py: string) => `${round(Number(px) + shiftX)},${round(Number(py) + shiftY)}`,
    )
  const leaving = new Set(arrows.filter((edge) => edge.from !== edge.to).map((edge) => edge.from))
  return {
    width: round(extent.right - extent.left + metrics.margin * 2),
    height: round(extent.bottom - extent.top + metrics.margin * 2),
    states: states.map((state) => {
      const box = boxes.get(state)!
      return {
        id: state,
        x: round(box.x + shiftX),
        y: round(box.y + shiftY),
        width: round(box.width),
        height: box.height,
        rank: box.rank,
        initial: state === initial,
        final: !leaving.has(state),
        unreachable: !reached.has(state),
      }
    }),
    edges: placed.map(({ edge, x: labelX, y: labelY }) => ({
      ...edge,
      path: moved(edge.path),
      head: moved(edge.head),
      label: { x: round(labelX + shiftX), y: round(labelY + shiftY) },
    })),
    ...(dot && first
      ? {
          start: {
            x: round(dot.x + shiftX),
            y: round(dot.y + shiftY),
            path: moved(`M${at(dot)} L${at({ x: first.x - 1.5, y: dot.y })}`),
            head: moved(headAt({ x: first.x - 1.5, y: dot.y }, dot, metrics.arrow)),
          },
        }
      : {}),
  }
}
