import { describe, expect, test } from 'bun:test'

import { layoutMachine, type Machine } from '../layout'
import { DIAGRAM_METRICS } from '../use-state-diagram'

/** A ticket: opened, taken, then closed or solved; either can be opened again. */
const TICKET: Machine = {
  initial: 'open',
  states: ['open', 'taken', 'closed', 'solved'],
  transitions: [
    { from: 'open', event: 'take', to: 'taken' },
    { from: 'open', event: 'close', to: 'closed' },
    { from: 'taken', event: 'close', to: 'closed' },
    { from: 'taken', event: 'solve', to: 'solved' },
    { from: 'taken', event: 'release', to: 'open' },
    { from: 'closed', event: 'reopen', to: 'open' },
    { from: 'solved', event: 'reopen', to: 'open' },
  ],
}

const stateOf = (layout: ReturnType<typeof layoutMachine>, id: string) =>
  layout.states.find((state) => state.id === id)!
const edgeOf = (layout: ReturnType<typeof layoutMachine>, id: string) =>
  layout.edges.find((edge) => edge.id === id)!

describe('a machine laid out', () => {
  const layout = layoutMachine(TICKET, DIAGRAM_METRICS.sm)

  test('ranks each state by how far it is from the initial one', () => {
    expect(layout.states.map((state) => [state.id, state.rank])).toEqual([
      ['open', 0],
      ['taken', 1],
      ['closed', 1],
      ['solved', 2],
    ])
    expect(stateOf(layout, 'open').initial).toBe(true)
    expect(stateOf(layout, 'taken').x).toBeGreaterThan(stateOf(layout, 'open').x)
    expect(stateOf(layout, 'solved').x).toBeGreaterThan(stateOf(layout, 'taken').x)
  })

  test('no two states overlap, and every one stands inside the diagram', () => {
    for (const one of layout.states) {
      expect(one.x).toBeGreaterThanOrEqual(0)
      expect(one.y).toBeGreaterThanOrEqual(0)
      expect(one.x + one.width).toBeLessThanOrEqual(layout.width)
      expect(one.y + one.height).toBeLessThanOrEqual(layout.height)
      for (const two of layout.states) {
        if (one === two) continue
        const apart =
          one.x + one.width <= two.x ||
          two.x + two.width <= one.x ||
          one.y + one.height <= two.y ||
          two.y + two.height <= one.y
        expect(apart).toBe(true)
      }
    }
  })

  test('draws one arrow per pair of states, by the plainest route', () => {
    expect(layout.edges.map((edge) => edge.id).sort()).toEqual(
      [
        'closed→open',
        'open→closed',
        'open→taken',
        'solved→open',
        'taken→closed',
        'taken→open',
        'taken→solved',
      ].sort(),
    )
    expect(edgeOf(layout, 'open→taken').route).toBe('direct')
    expect(edgeOf(layout, 'taken→closed').route).toBe('direct')
    // back across a rank: over or under the diagram
    expect(edgeOf(layout, 'solved→open').route).toBe('around')
  })

  test('marks where every one starts', () => {
    const open = stateOf(layout, 'open')
    expect(layout.start!.x).toBeLessThan(open.x)
    expect(layout.start!.y).toBe(open.y + open.height / 2)
  })
})

describe('what a machine declares', () => {
  test('transitions between the same two states are one arrow carrying every event', () => {
    const layout = layoutMachine(
      {
        initial: 'draft',
        states: ['draft', 'sent'],
        transitions: [
          { from: 'draft', event: 'send', to: 'sent' },
          { from: 'draft', event: 'schedule', to: 'sent' },
        ],
      },
      DIAGRAM_METRICS.md,
    )
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]!.events).toEqual(['send', 'schedule'])
  })

  test('a state nothing leaves is final; one that only loops is final too', () => {
    const layout = layoutMachine(
      {
        initial: 'on',
        states: ['on', 'off'],
        transitions: [
          { from: 'on', event: 'stop', to: 'off' },
          { from: 'off', event: 'ping', to: 'off' },
        ],
      },
      DIAGRAM_METRICS.sm,
    )
    expect(stateOf(layout, 'on').final).toBe(false)
    expect(stateOf(layout, 'off').final).toBe(true)
    expect(edgeOf(layout, 'off→off').route).toBe('loop')
  })

  test('a state no transition reaches stands after every other, and says so', () => {
    const layout = layoutMachine(
      {
        initial: 'a',
        states: ['a', 'b', 'lost'],
        transitions: [{ from: 'a', event: 'go', to: 'b' }],
      },
      DIAGRAM_METRICS.sm,
    )
    expect(stateOf(layout, 'lost').unreachable).toBe(true)
    expect(stateOf(layout, 'lost').rank).toBe(2)
    expect(stateOf(layout, 'b').unreachable).toBe(false)
  })

  test('two states of one rank that are not neighbours are joined by an arc at its side', () => {
    const layout = layoutMachine(
      {
        initial: 'start',
        states: ['start', 'a', 'b', 'c'],
        transitions: [
          { from: 'start', event: 'a', to: 'a' },
          { from: 'start', event: 'b', to: 'b' },
          { from: 'start', event: 'c', to: 'c' },
          { from: 'a', event: 'skip', to: 'c' },
        ],
      },
      DIAGRAM_METRICS.sm,
    )
    expect(edgeOf(layout, 'a→c').route).toBe('side')
  })

  test('a transition that names an unknown state is left out; no state, no diagram', () => {
    const layout = layoutMachine(
      { states: ['only'], transitions: [{ from: 'only', event: 'go', to: 'nowhere' }] },
      DIAGRAM_METRICS.sm,
    )
    expect(layout.edges).toEqual([])
    expect(stateOf(layout, 'only').initial).toBe(true)
    expect(layoutMachine({ states: [], transitions: [] }, DIAGRAM_METRICS.sm)).toEqual({
      width: 0,
      height: 0,
      states: [],
      edges: [],
    })
  })
})

describe('sizes', () => {
  test('a larger size writes event names, and stands states apart enough to hold them', () => {
    const small = layoutMachine(TICKET, DIAGRAM_METRICS.sm)
    const large = layoutMachine(TICKET, DIAGRAM_METRICS.lg)
    expect(large.width).toBeGreaterThan(small.width)
    const gap = (layout: typeof small) =>
      stateOf(layout, 'taken').x - (stateOf(layout, 'open').x + stateOf(layout, 'open').width)
    expect(gap(large)).toBeGreaterThan('release'.length * DIAGRAM_METRICS.lg.labelCharWidth)
    expect(gap(small)).toBeLessThan(gap(large))
  })

  test('names written between two ranks do not sit on one another', () => {
    const layout = layoutMachine(TICKET, DIAGRAM_METRICS.lg)
    const metrics = DIAGRAM_METRICS.lg
    const boxes = layout.edges.map((edge) => ({
      id: edge.id,
      halfW: (Math.max(...edge.events.map((event) => event.length)) * metrics.labelCharWidth) / 2,
      halfH: (edge.events.length * metrics.labelHeight) / 2,
      ...edge.label,
    }))
    for (const one of boxes)
      for (const two of boxes) {
        if (one.id >= two.id) continue
        const apart =
          Math.abs(one.x - two.x) >= one.halfW + two.halfW ||
          Math.abs(one.y - two.y) >= one.halfH + two.halfH
        expect(apart).toBe(true)
      }
  })
})
