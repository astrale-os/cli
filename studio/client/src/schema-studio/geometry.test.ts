import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { growModuleBoxes, packPendingNodes } from './geometry'
import { CLASS_H, CLASS_W, MODULE_HEADER, MODULE_PAD } from './palette'

const moduleBox = (id: string): Node => ({
  id,
  type: 'group',
  position: { x: 0, y: 0 },
  data: {},
})

const classNode = (id: string, parentId: string): Node => ({
  id,
  type: 'classNode',
  parentId,
  position: { x: 0, y: 0 },
  data: {},
})

test('a class added to a module grows the box that would otherwise clamp it', () => {
  const box = moduleBox('grp-shared')
  const known = classNode('class.Document', 'grp-shared')
  const added = classNode('class.Party', 'grp-shared')

  const geometry = packPendingNodes(
    [
      { node: box, position: { x: 1546, y: 38, w: 220, h: 96 } },
      { node: known, position: { x: MODULE_PAD, y: MODULE_HEADER } },
    ],
    [added],
  )

  // extent:'parent' clamps a class to its box, so a box left at 96 tall would drop the
  // new class back on top of its sibling.
  expect(geometry['class.Party']?.y).toBeGreaterThanOrEqual(MODULE_HEADER + CLASS_H)
  expect(geometry['grp-shared']?.h).toBeGreaterThanOrEqual(
    geometry['class.Party']!.y + CLASS_H + MODULE_PAD,
  )
  expect(geometry['grp-shared']?.x).toBe(1546)
})

test('boxes already containing their classes are left alone', () => {
  const box = moduleBox('grp-people')
  const child = classNode('class.Person', 'grp-people')
  const grown = growModuleBoxes([box, child], {
    'grp-people': { x: 0, y: 0, w: MODULE_PAD * 2 + CLASS_W, h: 300 },
    'class.Person': { x: MODULE_PAD, y: MODULE_HEADER },
  })

  expect(grown).toEqual({})
})
