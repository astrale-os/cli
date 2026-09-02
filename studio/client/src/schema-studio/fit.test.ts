import { expect, test } from 'bun:test'

import { revealViewport, type CanvasBox } from './fit'

const PANE = { width: 800, height: 600 }
const card = (x: number, y: number): CanvasBox => ({ x, y, width: 184, height: 40 })
/** Where a box's centre lands on screen under a viewport. */
const screen = (
  box: CanvasBox,
  viewport: { x: number; y: number; zoom: number },
): { x: number; y: number } => ({
  x: (box.x + box.width / 2) * viewport.zoom + viewport.x,
  y: (box.y + box.height / 2) * viewport.zoom + viewport.y,
})

test('a target already in the pane leaves the canvas exactly where the reader put it', () => {
  const box = card(300, 250)
  expect(revealViewport([box], { x: 0, y: 0, zoom: 1 }, PANE.width, PANE.height, 0.08)).toBeNull()
  expect(revealViewport([], { x: 0, y: 0, zoom: 1 }, PANE.width, PANE.height, 0.08)).toBeNull()
})

test('a single off-screen card is centred at the zoom already chosen', () => {
  const box = card(4000, 3000)
  const framing = revealViewport([box], { x: 0, y: 0, zoom: 0.5 }, PANE.width, PANE.height, 0.08)
  expect(framing?.zoom).toBe(0.5)
  expect(screen(box, framing!)).toEqual({ x: PANE.width / 2, y: PANE.height / 2 })
})

test('a relationship wider than the pane backs the zoom off until both ends read', () => {
  // 3000 units apart at zoom 1 — no pan alone can hold both ends of that in an 800px pane.
  const left = card(0, 0)
  const right = card(3000, 0)
  const framing = revealViewport(
    [left, right],
    { x: 0, y: 0, zoom: 1 },
    PANE.width,
    PANE.height,
    0.08,
  )
  expect(framing!.zoom).toBeLessThan(1)
  for (const end of [left, right]) {
    const at = screen(end, framing!)
    expect(at.x).toBeGreaterThan(24)
    expect(at.x).toBeLessThan(PANE.width - 24)
    expect(at.y).toBeGreaterThan(24)
    expect(at.y).toBeLessThan(PANE.height - 24)
  }
})

test('a relationship that fits is panned to WITHOUT zooming in on it', () => {
  // A jump answers "where is it", not "how close do you want it".
  const framing = revealViewport(
    [card(4000, 3000), card(4300, 3000)],
    { x: 0, y: 0, zoom: 0.5 },
    PANE.width,
    PANE.height,
    0.08,
  )
  expect(framing?.zoom).toBe(0.5)
})

test('the zoom floor is honoured even when the span cannot fit under it', () => {
  const framing = revealViewport(
    [card(0, 0), card(500_000, 0)],
    { x: 0, y: 0, zoom: 1 },
    PANE.width,
    PANE.height,
    0.08,
  )
  expect(framing?.zoom).toBe(0.08)
})
