import type { Edge, Node } from '@xyflow/react'

import { describe, expect, test } from 'bun:test'

import {
  DOCK_COLUMN_GAP,
  DOCK_ROW_GAP,
  DOCK_SECTION_GAP,
  dockColumns,
  dockGeometry,
  layoutDomain,
  packPendingDocked,
} from './dock-layout'
import { FUNCTION_H, FUNCTION_W, VIEW_H } from './palette'

const view = (slug: string): Node => ({
  id: `view.${slug}`,
  type: 'viewNode',
  position: { x: 0, y: 0 },
  data: {},
})

const fn = (name: string): Node => ({
  id: `function.${name}`,
  type: 'functionNode',
  position: { x: 0, y: 0 },
  data: {},
})

const functions = (count: number) =>
  Array.from({ length: count }, (_, index) => fn(`f${String(index).padStart(2, '0')}`))

describe('dock layout', () => {
  test('the application sits at the top left, its Functions right under it', () => {
    const { geometry } = dockGeometry([fn('install'), view('application'), fn('archive')])

    expect(geometry['view.application']).toEqual({ x: 0, y: 0 })
    const top = VIEW_H + DOCK_SECTION_GAP
    expect(geometry['function.archive']).toEqual({ x: 0, y: top })
    expect(geometry['function.install']).toEqual({ x: 0, y: top + FUNCTION_H + DOCK_ROW_GAP })
  })

  test('the same members land the same way whatever order they arrive in', () => {
    const members = [view('application'), ...functions(12)]
    expect(dockGeometry([...members].reverse())).toEqual(dockGeometry(members))
  })

  test('many Functions are packed into columns filled top to bottom', () => {
    expect(dockColumns(8)).toBe(1)
    expect(dockColumns(9)).toBe(2)
    expect(dockColumns(21)).toBe(3)

    const { geometry, w } = dockGeometry(functions(12))
    expect(geometry['function.f00']).toEqual({ x: 0, y: 0 })
    expect(geometry['function.f05']?.x).toBe(0)
    expect(geometry['function.f06']).toEqual({ x: FUNCTION_W + DOCK_COLUMN_GAP, y: 0 })
    expect(w).toBe(FUNCTION_W * 2 + DOCK_COLUMN_GAP)
  })

  test('a domain with only unwired members needs no layout engine', async () => {
    const geometry = await layoutDomain([view('application'), fn('install')], [])
    expect(geometry['view.application']).toEqual({ x: 0, y: 0 })
    expect(geometry['function.install']?.y).toBe(VIEW_H + DOCK_SECTION_GAP)
  })

  test('a Function added later joins the bottom of the dock, a wired one does not', () => {
    const edges: Edge[] = [{ id: 'e', source: 'function.bound', target: 'class.User' }]
    const geometry = packPendingDocked(
      [
        { node: view('application'), position: { x: 52, y: 52 } },
        { node: fn('archive'), position: { x: 52, y: 104 } },
      ],
      [fn('install'), fn('bound')],
      edges,
    )

    expect(geometry).toEqual({
      'function.install': { x: 52, y: 104 + FUNCTION_H + DOCK_ROW_GAP },
    })
  })
})
