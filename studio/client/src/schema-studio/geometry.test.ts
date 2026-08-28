import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { fitModuleBoxes, normalizeModuleLayout, packPendingNodes } from './geometry'
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

  // a box left at 96 tall would drop the new class back on top of its sibling.
  expect(geometry['class.Party']?.y).toBeGreaterThanOrEqual(MODULE_HEADER + CLASS_H)
  expect(geometry['grp-shared']?.h).toBeGreaterThanOrEqual(
    geometry['class.Party']!.y + CLASS_H + MODULE_PAD,
  )
  expect(geometry['grp-shared']?.x).toBe(1546)
})

test('boxes already wrapping their classes are left alone', () => {
  const box = moduleBox('grp-people')
  const child = classNode('class.Person', 'grp-people')
  const fitted = fitModuleBoxes([box, child], {
    'grp-people': {
      x: 0,
      y: 0,
      w: MODULE_PAD * 2 + CLASS_W,
      h: MODULE_HEADER + CLASS_H + MODULE_PAD,
    },
    'class.Person': { x: MODULE_PAD, y: MODULE_HEADER },
  })

  expect(fitted).toEqual({})
})

test('a box keeps no more room than its classes use', () => {
  const box = moduleBox('grp-people')
  const child = classNode('class.Person', 'grp-people')
  const fitted = fitModuleBoxes([box, child], {
    'grp-people': { x: 0, y: 0, w: 900, h: 640 },
    'class.Person': { x: MODULE_PAD, y: MODULE_HEADER },
  })

  expect(fitted['grp-people']).toEqual({
    x: 0,
    y: 0,
    w: MODULE_PAD * 2 + CLASS_W,
    h: MODULE_HEADER + CLASS_H + MODULE_PAD,
  })
})

test('a class dragged onto the module label is pushed back under it', () => {
  const [, child] = normalizeModuleLayout([
    { ...moduleBox('grp-people'), style: { width: 400, height: 400 } },
    { ...classNode('class.Person', 'grp-people'), position: { x: -60, y: 4 } },
  ])

  expect(child.position).toEqual({ x: MODULE_PAD, y: MODULE_HEADER })
})

test('a class dragged out re-sizes its box, padding included', () => {
  const [box] = normalizeModuleLayout([
    moduleBox('grp-people'),
    { ...classNode('class.Person', 'grp-people'), position: { x: 300, y: 200 } },
  ])

  expect(box.style).toMatchObject({
    width: 300 + CLASS_W + MODULE_PAD,
    height: 200 + CLASS_H + MODULE_PAD,
  })
})

test('classes dragged back together shrink the box they share', () => {
  const [box] = normalizeModuleLayout([
    { ...moduleBox('grp-people'), style: { width: 900, height: 640 } },
    { ...classNode('class.Person', 'grp-people'), position: { x: MODULE_PAD, y: MODULE_HEADER } },
    {
      ...classNode('class.Team', 'grp-people'),
      position: { x: MODULE_PAD, y: MODULE_HEADER + CLASS_H + 12 },
    },
  ])

  expect(box.style).toMatchObject({
    width: MODULE_PAD * 2 + CLASS_W,
    height: MODULE_HEADER + CLASS_H + 12 + CLASS_H + MODULE_PAD,
  })
})

test("an imported domain's members are left where their own box puts them", () => {
  // an extDomain has children and a header too, but a SMALLER one — module insets must
  // not reach it, or every imported member shifts on the first drag anywhere on the canvas.
  const [, extDomain, member] = normalizeModuleLayout([
    moduleBox('grp-people'),
    { ...moduleBox('extdom.acme'), id: 'extdom.acme', type: 'extDomain' },
    {
      ...classNode('extmember.acme.Order', 'extdom.acme'),
      type: 'extMember',
      position: { x: 12, y: 36 },
    },
  ])

  expect(member.position).toEqual({ x: 12, y: 36 })
  expect(extDomain.style).toBeUndefined()
})
