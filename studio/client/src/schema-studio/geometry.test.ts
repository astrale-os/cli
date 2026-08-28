import type { Node } from '@xyflow/react'

import { expect, test } from 'bun:test'

import { fitModuleBoxes, normalizeContainerLayout, packPendingNodes } from './geometry'
import { CLASS_H, CLASS_W, DOMAIN_PAD, MODULE_HEADER, MODULE_PAD } from './palette'

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

const domainFrame = (id: string, x: number, y: number): Node => ({
  id,
  type: 'workspaceDomain',
  position: { x, y },
  data: {},
  style: { width: 360, height: 220 },
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

test('a class dragged past the module label takes the box with it, never the reverse', () => {
  const [box, child] = normalizeContainerLayout([
    { ...moduleBox('grp-people'), position: { x: 400, y: 300 } },
    { ...classNode('class.Person', 'grp-people'), position: { x: -60, y: 4 } },
  ])

  // the class holds the ground it was dragged to: 400 - 60 = 340, 300 + 4 = 304
  expect(box.position.x + child.position.x).toBe(340)
  expect(box.position.y + child.position.y).toBe(304)
  // and it sits on the insets again, so the label above it is never covered
  expect(child.position).toEqual({ x: MODULE_PAD, y: MODULE_HEADER })
})

test('a box grown leftwards keeps the same margin on both sides', () => {
  const [box] = normalizeContainerLayout([
    moduleBox('grp-people'),
    { ...classNode('class.Person', 'grp-people'), position: { x: -60, y: MODULE_HEADER } },
    { ...classNode('class.Team', 'grp-people'), position: { x: 240, y: MODULE_HEADER } },
  ])

  // 60 of overflow on the left, 240 - (-60) = 300 between the two classes
  expect(box.position.x).toBe(-(MODULE_PAD + 60))
  expect(box.style).toMatchObject({ width: MODULE_PAD * 2 + 300 + CLASS_W })
})

test('a lone class dragged anywhere moves its box instead of stretching it', () => {
  const [box, child] = normalizeContainerLayout([
    moduleBox('grp-people'),
    { ...classNode('class.Person', 'grp-people'), position: { x: 300, y: 200 } },
  ])

  // one class, one margin all round — so the box travels with the only thing it holds
  expect(box.position).toEqual({ x: 300 - MODULE_PAD, y: 200 - MODULE_HEADER })
  expect(child.position).toEqual({ x: MODULE_PAD, y: MODULE_HEADER })
  expect(box.style).toMatchObject({
    width: MODULE_PAD * 2 + CLASS_W,
    height: MODULE_HEADER + CLASS_H + MODULE_PAD,
  })
})

test('a class dragged away from its siblings stretches the box, padding included', () => {
  const [box] = normalizeContainerLayout([
    moduleBox('grp-people'),
    { ...classNode('class.Person', 'grp-people'), position: { x: MODULE_PAD, y: MODULE_HEADER } },
    { ...classNode('class.Team', 'grp-people'), position: { x: 300, y: 200 } },
  ])

  expect(box.style).toMatchObject({
    width: 300 + CLASS_W + MODULE_PAD,
    height: 200 + CLASS_H + MODULE_PAD,
  })
})

test('classes dragged back together shrink the box they share', () => {
  const [box] = normalizeContainerLayout([
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

test('a module dragged out of its domain moves the frame that has to wrap it', () => {
  const [frame, module] = normalizeContainerLayout([
    domainFrame('workspace-domain:issues', 1000, 1000),
    {
      ...moduleBox('grp-people'),
      parentId: 'workspace-domain:issues',
      position: { x: DOMAIN_PAD - 80, y: DOMAIN_PAD - 30 },
      style: { width: 300, height: 200 },
    },
  ])

  expect(frame.position).toEqual({ x: 920, y: 970 })
  expect(module.position).toEqual({ x: DOMAIN_PAD, y: DOMAIN_PAD })
  // the module ends up exactly where the drag left it: 1000 - 80, 1000 - 30
  expect(frame.position.x + module.position.x).toBe(920 + DOMAIN_PAD)
  expect(frame.style).toMatchObject({ width: DOMAIN_PAD * 2 + 300, height: DOMAIN_PAD * 2 + 200 })
})

test('a class dragged past its module edge carries the domain frame along too', () => {
  const [frame, module, child] = normalizeContainerLayout([
    domainFrame('workspace-domain:issues', 1000, 1000),
    {
      ...moduleBox('grp-people'),
      parentId: 'workspace-domain:issues',
      position: { x: DOMAIN_PAD, y: DOMAIN_PAD },
      style: { width: MODULE_PAD * 2 + CLASS_W, height: MODULE_HEADER + CLASS_H + MODULE_PAD },
    },
    {
      ...classNode('class.Person', 'grp-people'),
      position: { x: MODULE_PAD - 60, y: MODULE_HEADER },
    },
  ])

  // the class moved 60 to the left, so both boxes around it did as well
  expect(frame.position).toEqual({ x: 940, y: 1000 })
  expect(module.position).toEqual({ x: DOMAIN_PAD, y: DOMAIN_PAD })
  expect(child.position).toEqual({ x: MODULE_PAD, y: MODULE_HEADER })
  expect(frame.position.x + module.position.x + child.position.x).toBe(
    1000 + DOMAIN_PAD + MODULE_PAD - 60,
  )
})

test('a domain frame gives back the room its modules stopped using', () => {
  const [frame] = normalizeContainerLayout([
    { ...domainFrame('workspace-domain:issues', 0, 0), style: { width: 1600, height: 1200 } },
    {
      ...moduleBox('grp-people'),
      parentId: 'workspace-domain:issues',
      position: { x: DOMAIN_PAD, y: DOMAIN_PAD },
      style: { width: 300, height: 200 },
    },
  ])

  expect(frame.style).toMatchObject({ width: DOMAIN_PAD * 2 + 300, height: DOMAIN_PAD * 2 + 200 })
})

test("an imported domain's members are left where their own box puts them", () => {
  // an extDomain has children and a header too, but a SMALLER one — module insets must
  // not reach it, or every imported member shifts on the first drag anywhere on the canvas.
  const [, extDomain, member] = normalizeContainerLayout([
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

test('a frame that holds one small module still keeps one padding all round', () => {
  const [frame] = normalizeContainerLayout([
    domainFrame('workspace-domain:issues', 0, 0),
    {
      ...moduleBox('grp-people'),
      parentId: 'workspace-domain:issues',
      position: { x: DOMAIN_PAD, y: DOMAIN_PAD },
      style: { width: 200, height: 90 },
    },
  ])

  // the empty-frame size (360 x 220) is not a floor: it would pad the bottom twice over
  expect(frame.style).toMatchObject({ width: DOMAIN_PAD * 2 + 200, height: DOMAIN_PAD * 2 + 90 })
})
