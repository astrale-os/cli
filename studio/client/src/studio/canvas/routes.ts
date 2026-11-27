/**
 * Geometry of a drawn link: polylines in world units, as the layout routed them.
 *
 * A trunk is laid out once, as one route; its members open as parallel copies of it,
 * offset sideways by a fixed spread, so opening a trunk never moves a box or another link.
 */

import type { EdgePathSample } from '../../schema-studio/edge-label-layout'
import type { Point } from './geometry'

/** The route without repeated points: every segment has a length and a direction. */
export function cleanPolyline(points: readonly Point[]): Point[] {
  const clean: Point[] = []
  for (const point of points) {
    const last = clean.at(-1)
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.01) clean.push({ ...point })
  }
  return clean
}

export function polylineLength(points: readonly Point[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    )
  }
  return length
}

/** The point `distance` along the route, with the direction it travels there. */
export function pointAt(
  points: readonly Point[],
  distance: number,
): Point & { dx: number; dy: number } {
  let left = Math.max(0, distance)
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!
    const to = points[index]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length === 0) continue
    if (left <= length || index === points.length - 1) {
      const t = Math.min(1, left / length)
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        dx: (to.x - from.x) / length,
        dy: (to.y - from.y) / length,
      }
    }
    left -= length
  }
  const only = points[0] ?? { x: 0, y: 0 }
  return { ...only, dx: 1, dy: 0 }
}

/** Evenly spaced samples along the route, each with its distance from the start. */
export function samplePolyline(points: readonly Point[], step = 8): EdgePathSample[] {
  const length = polylineLength(points)
  if (points.length < 2 || length === 0) return []
  const count = Math.max(1, Math.ceil(length / step))
  return Array.from({ length: count + 1 }, (_, index) => {
    const distance = (length * index) / count
    const { x, y } = pointAt(points, distance)
    return { x, y, distance }
  })
}

/**
 * The route moved `offset` to its left (negative: right), corners mitred so parallel
 * copies stay parallel. Its ends slide along the sides they leave and enter.
 */
export function offsetPolyline(points: readonly Point[], offset: number): Point[] {
  const clean = cleanPolyline(points)
  if (clean.length < 2 || offset === 0) return clean
  const normals = clean.slice(1).map((to, index) => {
    const from = clean[index]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    return { x: -(to.y - from.y) / length, y: (to.x - from.x) / length }
  })
  return clean.map((point, index) => {
    const before = normals[index - 1]
    const after = normals[index]
    if (!before || !after) {
      const normal = (before ?? after)!
      return { x: point.x + normal.x * offset, y: point.y + normal.y * offset }
    }
    const dot = before.x * after.x + before.y * after.y
    // A route folding back on itself has no mitre: keep the incoming side.
    if (1 + dot < 1e-6) return { x: point.x + before.x * offset, y: point.y + before.y * offset }
    const scale = offset / (1 + dot)
    return { x: point.x + (before.x + after.x) * scale, y: point.y + (before.y + after.y) * scale }
  })
}

/** Sideways offsets of a trunk's members, centred on the route, in member order. */
export function memberOffsets(count: number, spread: number): number[] {
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spread)
}

const round = (value: number) => Math.round(value * 10) / 10

/** SVG path data for the route, its corners rounded by up to `radius`. */
export function roundedPath(points: readonly Point[], radius = 8): string {
  const clean = cleanPolyline(points)
  if (clean.length === 0) return ''
  const first = clean[0]!
  let path = `M${round(first.x)},${round(first.y)}`
  for (let index = 1; index < clean.length; index += 1) {
    const point = clean[index]!
    const next = clean[index + 1]
    if (!next) {
      path += ` L${round(point.x)},${round(point.y)}`
      break
    }
    const previous = clean[index - 1]!
    const inLength = Math.hypot(point.x - previous.x, point.y - previous.y)
    const outLength = Math.hypot(next.x - point.x, next.y - point.y)
    const corner = Math.min(radius, inLength / 2, outLength / 2)
    const enter = {
      x: point.x - ((point.x - previous.x) / inLength) * corner,
      y: point.y - ((point.y - previous.y) / inLength) * corner,
    }
    const leave = {
      x: point.x + ((next.x - point.x) / outLength) * corner,
      y: point.y + ((next.y - point.y) / outLength) * corner,
    }
    path += ` L${round(enter.x)},${round(enter.y)} Q${round(point.x)},${round(point.y)} ${round(leave.x)},${round(leave.y)}`
  }
  return path
}

/** The route with its end drawn back by `length`, so a stroke stops under its arrowhead. */
export function trimEnd(points: readonly Point[], length: number): Point[] {
  const clean = cleanPolyline(points)
  const total = polylineLength(clean)
  if (clean.length < 2 || total <= length) return clean
  const end = pointAt(clean, total - length)
  let walked = 0
  const kept: Point[] = [clean[0]!]
  for (let index = 1; index < clean.length; index += 1) {
    const segment = Math.hypot(
      clean[index]!.x - clean[index - 1]!.x,
      clean[index]!.y - clean[index - 1]!.y,
    )
    if (walked + segment >= total - length) break
    walked += segment
    kept.push(clean[index]!)
  }
  kept.push({ x: end.x, y: end.y })
  return kept
}

/** A filled arrowhead whose tip is the route's last point, `size` long. */
export function arrowHead(points: readonly Point[], size = 7): string {
  const clean = cleanPolyline(points)
  if (clean.length < 2) return ''
  const tip = clean.at(-1)!
  const { dx, dy } = pointAt(clean, polylineLength(clean))
  const base = { x: tip.x - dx * size, y: tip.y - dy * size }
  const half = size * 0.45
  return `M${round(tip.x)},${round(tip.y)} L${round(base.x - dy * half)},${round(base.y + dx * half)} L${round(base.x + dy * half)},${round(base.y - dx * half)} Z`
}

export function reversed(points: readonly Point[]): Point[] {
  return [...points].reverse()
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high))

/**
 * A fan's spoke: a curve that leaves the junction level, reaches across, and enters the
 * box on the side facing it — level with the junction wherever the box spans that height.
 * Sampled into a route, so it is hit, bounded and dimmed like any other.
 */
export function spoke(
  from: Point,
  to: { x: number; y: number; width: number; height: number },
  samples = 16,
): Point[] {
  const entersLeft = to.x + to.width / 2 >= from.x
  const end = {
    x: entersLeft ? to.x : to.x + to.width,
    y: clamp(from.y, to.y + 10, to.y + to.height - 10),
  }
  const reach = (end.x - from.x) / 2
  const first = { x: from.x + reach, y: from.y }
  const second = { x: end.x - reach, y: end.y }
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    return {
      x: a * from.x + b * first.x + c * second.x + d * end.x,
      y: a * from.y + b * first.y + c * second.y + d * end.y,
    }
  })
}
