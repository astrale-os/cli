/**
 * The camera: a world → screen transform, the zoom tiers that decide what a box shows,
 * and the moves the canvas makes (fit, zoom about a point, bring a rect into view).
 */

import type { Rect } from './geometry'

/** screen = world × zoom + (x, y) */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Far: names and counts. Middle: link labels and badges. Near: properties and end counts. */
export type Tier = 'far' | 'middle' | 'near'

export const ZOOM = { min: 0.08, max: 2.5 } as const

/** Tier bounds, with hysteresis: a zoom hovering at a bound never flickers between two. */
const TIER = { farEnter: 0.48, farExit: 0.52, nearEnter: 1.2, nearExit: 1.1 } as const

export function tierFor(zoom: number, previous?: Tier): Tier {
  if (previous === 'far' && zoom < TIER.farExit) return 'far'
  if (previous === 'near' && zoom >= TIER.nearExit) return 'near'
  if (zoom < TIER.farEnter) return 'far'
  if (zoom >= TIER.nearEnter) return 'near'
  return 'middle'
}

export const clampZoom = (zoom: number, max: number = ZOOM.max) =>
  Math.min(max, Math.max(ZOOM.min, zoom))

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/** The part of the pane its insets leave uncovered, as a width and a height; never negative. */
export function shownSize(pane: { width: number; height: number }, insets: Insets = NO_INSETS) {
  return {
    width: Math.max(0, pane.width - insets.left - insets.right),
    height: Math.max(0, pane.height - insets.top - insets.bottom),
  }
}

/** A margin kept around what is framed: never more than a tenth of the room on either side. */
const marginIn = (margin: number, room: { width: number; height: number }) =>
  Math.min(margin, room.width / 10, room.height / 10)

/**
 * The viewport showing `bounds` whole, centred in the pane minus its insets. Fitting never
 * zooms past `maxZoom`: a small scene reads at its natural size, not blown up.
 */
export function fitViewport(
  bounds: Rect,
  pane: { width: number; height: number },
  {
    padding = 48,
    maxZoom = 1,
    insets = NO_INSETS,
  }: { padding?: number; maxZoom?: number; insets?: Insets } = {},
): Viewport {
  const room = shownSize(pane, insets)
  const pad = marginIn(padding, room)
  const width = Math.max(1, room.width - pad * 2)
  const height = Math.max(1, room.height - pad * 2)
  const zoom = clampZoom(
    Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height), maxZoom),
  )
  const centre = {
    x: insets.left + (pane.width - insets.left - insets.right) / 2,
    y: insets.top + (pane.height - insets.top - insets.bottom) / 2,
  }
  return {
    zoom,
    x: centre.x - (bounds.x + bounds.width / 2) * zoom,
    y: centre.y - (bounds.y + bounds.height / 2) * zoom,
  }
}

/** Zoom by `factor` keeping the world point under `screen` where it is. */
export function zoomAbout(
  viewport: Viewport,
  screen: { x: number; y: number },
  factor: number,
): Viewport {
  const zoom = clampZoom(viewport.zoom * factor)
  const scale = zoom / viewport.zoom
  return {
    zoom,
    x: screen.x - (screen.x - viewport.x) * scale,
    y: screen.y - (screen.y - viewport.y) * scale,
  }
}

export function toWorld(viewport: Viewport, screen: { x: number; y: number }) {
  return { x: (screen.x - viewport.x) / viewport.zoom, y: (screen.y - viewport.y) / viewport.zoom }
}

/** The world rect the pane shows. */
export function visibleWorld(viewport: Viewport, pane: { width: number; height: number }): Rect {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: pane.width / viewport.zoom,
    height: pane.height / viewport.zoom,
  }
}

/**
 * The smallest move that brings `rect` into what the insets leave of the pane: unchanged when it
 * already shows whole there, centred on it otherwise, zoomed out only when it cannot fit at the
 * current zoom.
 */
export function revealRect(
  viewport: Viewport,
  rect: Rect,
  pane: { width: number; height: number },
  insets: Insets = NO_INSETS,
  margin = 48,
): Viewport {
  const gap = marginIn(margin, shownSize(pane, insets))
  const shown = {
    left: insets.left + gap,
    top: insets.top + gap,
    right: pane.width - insets.right - gap,
    bottom: pane.height - insets.bottom - gap,
  }
  const screen = {
    left: rect.x * viewport.zoom + viewport.x,
    top: rect.y * viewport.zoom + viewport.y,
    right: (rect.x + rect.width) * viewport.zoom + viewport.x,
    bottom: (rect.y + rect.height) * viewport.zoom + viewport.y,
  }
  if (
    screen.left >= shown.left &&
    screen.right <= shown.right &&
    screen.top >= shown.top &&
    screen.bottom <= shown.bottom
  ) {
    return viewport
  }
  const fits =
    rect.width * viewport.zoom <= shown.right - shown.left &&
    rect.height * viewport.zoom <= shown.bottom - shown.top
  const zoom = fits
    ? viewport.zoom
    : clampZoom(
        Math.min(
          (shown.right - shown.left) / Math.max(1, rect.width),
          (shown.bottom - shown.top) / Math.max(1, rect.height),
        ),
      )
  return {
    zoom,
    x: (shown.left + shown.right) / 2 - (rect.x + rect.width / 2) * zoom,
    y: (shown.top + shown.bottom) / 2 - (rect.y + rect.height / 2) * zoom,
  }
}

const ease = (t: number) => 1 - (1 - t) ** 3

/** The viewport `t` (0..1) of the way from `from` to `to`, eased out. */
export function between(from: Viewport, to: Viewport, t: number): Viewport {
  const k = ease(Math.min(1, Math.max(0, t)))
  // Zoom interpolates geometrically so a large zoom change reads as steady motion.
  const zoom = from.zoom * (to.zoom / from.zoom) ** k
  return { zoom, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }
}
