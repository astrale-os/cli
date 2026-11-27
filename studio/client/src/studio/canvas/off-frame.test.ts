import { describe, expect, test } from 'bun:test'

import type { Rect } from './geometry'

import { type EdgePointer, offFrame, placePointers } from './off-frame'

const at = (x: number, y: number): Rect => ({ x: x - 5, y: y - 5, width: 10, height: 10 })
const shown = { left: 0, top: 0, right: 800, bottom: 600 }
const still = { x: 0, y: 0, zoom: 1 }

describe('where the places the pane does not show lie', () => {
  test('a place whose centre shows is not pointed to', () => {
    expect(offFrame(new Map([['a', at(400, 300)]]), still, shown)).toEqual([])
  })

  test('each place is pointed to from the edge its bearing crosses, the nearest first', () => {
    const rects = new Map([
      ['far-right', at(2000, 300)],
      ['near-right', at(1000, 350)],
      ['above', at(400, -500)],
      ['left', at(-300, 300)],
    ])
    const pointers = offFrame(rects, still, shown)
    expect(pointers.map((pointer) => [pointer.side, pointer.ids])).toEqual([
      ['top', ['above']],
      ['right', ['near-right', 'far-right']],
      ['left', ['left']],
    ])
    // the nearest's bearing from the centre crosses the right edge a little below the middle
    expect(pointers[1]!.at).toBeCloseTo(300 + (50 * 400) / 600)
  })

  test('the camera decides what shows: panned and zoomed, the same place shows or not', () => {
    const rects = new Map([['a', at(1000, 300)]])
    expect(offFrame(rects, { x: -600, y: 0, zoom: 1 }, shown)).toEqual([])
    expect(offFrame(rects, { x: 0, y: 0, zoom: 0.5 }, shown)).toEqual([])
    expect(offFrame(rects, { x: 0, y: 0, zoom: 2 }, shown).map((pointer) => pointer.side)).toEqual([
      'right',
    ])
  })

  test('what covers the pane counts as not shown; a pointer keeps clear of the corners', () => {
    const covered = { left: 0, top: 44, right: 800, bottom: 512 }
    const pointers = offFrame(
      new Map([
        ['a', at(400, 560)],
        ['b', at(5000, 5000)],
      ]),
      still,
      covered,
    )
    expect(pointers.map((pointer) => pointer.side)).toEqual(['bottom'])
    expect(pointers[0]!.ids).toEqual(['a', 'b'])
    expect(pointers[0]!.at).toBe(400)
    const corner = offFrame(new Map([['c', at(-1000, -800)]]), still, shown, 32)
    expect(corner[0]!.at).toBeGreaterThanOrEqual(32)
  })
})

describe('where a pointer sits on its edge', () => {
  const size = () => ({ width: 100, height: 28 })
  const left: EdgePointer = { side: 'left', ids: ['a'], at: 300 }
  const right: EdgePointer = { side: 'right', ids: ['b'], at: 300 }
  const clear = (a: Rect, b: Rect) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y

  test('where its bearing crosses, when no lit card is there', () => {
    const [placed] = placePointers([left], shown, [], size, 10)
    expect(placed!.rect).toEqual({ x: 10, y: 286, width: 100, height: 28 })
  })

  test('a lit card under that spot: the nearest free place along the same edge', () => {
    // a card read from x 0 to 300, y 250 to 420: right where the left pointer would sit
    const card = { x: 0, y: 250, width: 300, height: 170 }
    const [placed] = placePointers([left], shown, [card], size, 10)
    expect(placed!.rect.x).toBe(10)
    expect(clear(placed!.rect, card)).toBe(true)
    // above the card is nearer the bearing than below it
    expect(placed!.rect.y + placed!.rect.height).toBeLessThanOrEqual(250)
    expect(placed!.rect.y + placed!.rect.height).toBeGreaterThan(250 - 6 - 4 - 1)
  })

  test('an edge lit all along: where it covers least, nearest its bearing, still on that edge', () => {
    // a card down the whole edge, and a second one reaching further in around the bearing
    const wall = { x: 0, y: 0, width: 60, height: 600 }
    const deeper = { x: 60, y: 100, width: 30, height: 40 }
    const [placed] = placePointers([{ ...left, at: 120 }], shown, [wall, deeper], size, 10)
    expect(placed!.rect).toEqual({ x: 10, y: 66, width: 100, height: 28 })
  })

  test('two pointers never sit on each other', () => {
    const top: EdgePointer = { side: 'top', ids: ['c'], at: 40 }
    const corner: EdgePointer = { side: 'left', ids: ['d'], at: 32 }
    const [a, b] = placePointers([top, corner], shown, [], size, 10)
    expect(clear(a!.rect, b!.rect)).toBe(true)
    expect(placePointers([right], shown, [], size, 10)[0]!.rect.x).toBe(800 - 10 - 100)
  })
})
