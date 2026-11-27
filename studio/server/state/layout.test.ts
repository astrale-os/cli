import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LAYOUT_LIMITS } from '../../shared/contracts/workspace'
import { changeLensIds, readLayout, resetLayout, resetLensLayout, setLensPositions } from './layout'
import { UnreadableState } from './state-file'
import { statePath, writeJson } from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const domainRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-layout-'))
  roots.push(root)
  return root
}

test('each lens keeps its own arrangement', () => {
  const root = domainRoot()
  setLensPositions(root, 'structure', { 'class.A': { x: 10, y: 20 } }, 'fp-1')
  setLensPositions(root, 'behavior', { 'class.A': { x: -5, y: 7 } })
  // A later write merges into its lens and keeps every other position.
  setLensPositions(root, 'structure', { 'class.B': { x: 30, y: 40 } })

  expect(readLayout(root)).toEqual({
    renderFingerprint: 'fp-1',
    lenses: {
      structure: { 'class.A': { x: 10, y: 20 }, 'class.B': { x: 30, y: 40 } },
      behavior: { 'class.A': { x: -5, y: 7 } },
    },
  })
})

test('forgetting a lens returns only that lens to automatic layout', () => {
  const root = domainRoot()
  setLensPositions(root, 'structure', { 'class.A': { x: 10, y: 20 } })
  setLensPositions(root, 'behavior', { 'fn.run': { x: 0, y: 0 } })

  expect(resetLensLayout(root, 'structure')).toEqual({
    lenses: { behavior: { 'fn.run': { x: 0, y: 0 } } },
  })
  expect(resetLensLayout(root, 'behavior')).toEqual({})
  expect(readLayout(root)).toEqual({})

  setLensPositions(root, 'structure', { 'class.A': { x: 10, y: 20 } })
  resetLayout(root)
  expect(readLayout(root)).toEqual({})
})

test('a record this Studio does not decode whole is said as such, and no write goes over it', () => {
  const root = domainRoot()
  const path = statePath(root, 'layout.json')
  const unreadable = (raw: unknown, reason: string) => {
    writeJson(root, 'layout.json', raw)
    expect(() => readLayout(root)).toThrow(new UnreadableState(path, reason))
    expect(() => setLensPositions(root, 'structure', { 'class.C': { x: 0, y: 0 } })).toThrow(
      UnreadableState,
    )
    expect(() => changeLensIds(root, 'collapsed', 'structure', { add: ['m'], remove: [] })).toThrow(
      UnreadableState,
    )
    expect(() => resetLensLayout(root, 'structure')).toThrow(UnreadableState)
    expect(() => resetLayout(root)).toThrow(UnreadableState)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(raw)
  }
  unreadable(
    { lenses: { structure: { 'class.A': { x: 10, y: 'far' }, 'class.B': { x: 30, y: 40 } } } },
    'the box class.A stands at no x and y within 10000000 of 0',
  )
  unreadable({ lenses: { 'Not A Lens': {} } }, 'its arrangements name "Not A Lens", not a lens')
  unreadable(
    { collapsed: { behavior: ['module.b', 7] } },
    'item 2 of the shut modules of the lens behavior names no id',
  )
  unreadable({ opened: { structure: {} } }, 'the opened folds of the lens structure are not a list')
})

/** What main's Studio wrote: one arrangement, every Class's, under `positions`. */
const earlierStudio = {
  renderFingerprint: 'fp-main',
  positions: {
    'grp-billing': { x: 0, y: 0, w: 220, h: 140 },
    'class.Invoice': { x: 18, y: 56 },
  },
}

test("an earlier Studio's positions stay untouched through every write and every reset", () => {
  const root = domainRoot()
  const path = statePath(root, 'layout.json')
  const onDisk = () => JSON.parse(readFileSync(path, 'utf8'))
  writeJson(root, 'layout.json', earlierStudio)
  // read without them: they are not an arrangement any lens of this Studio reads
  expect(readLayout(root)).toEqual({ renderFingerprint: 'fp-main' })

  setLensPositions(root, 'structure', { 'class.Invoice': { x: 300, y: 40 } }, 'fp-2')
  changeLensIds(root, 'collapsed', 'structure', { add: ['module.billing'], remove: [] })
  changeLensIds(root, 'opened', 'rules', { add: ['class.Invoice#call'], remove: [] })
  expect(onDisk().positions).toEqual(earlierStudio.positions)

  resetLensLayout(root, 'structure')
  expect(onDisk().positions).toEqual(earlierStudio.positions)

  // forgetting every arrangement of this Studio leaves the earlier one for that Studio
  resetLayout(root)
  expect(onDisk()).toEqual({ positions: earlierStudio.positions })
  expect(readLayout(root)).toEqual({})
  // and with nothing of another Studio's in it, the file goes
  writeJson(root, 'layout.json', { lenses: { structure: {} } })
  resetLayout(root)
  expect(existsSync(path)).toBe(false)
})

test('a key this Studio does not know, on the record or a position, is kept through a rewrite', () => {
  const root = domainRoot()
  writeJson(root, 'layout.json', {
    lenses: { structure: { 'class.A': { x: 1, y: 2, pinnedBy: 'ann' } } },
    camera: { zoom: 2 },
  })
  setLensPositions(root, 'structure', { 'class.A': { x: 5, y: 6 }, 'class.B': { x: 0, y: 0 } })
  expect(JSON.parse(readFileSync(statePath(root, 'layout.json'), 'utf8'))).toEqual({
    lenses: {
      structure: { 'class.A': { x: 5, y: 6, pinnedBy: 'ann' }, 'class.B': { x: 0, y: 0 } },
    },
    camera: { zoom: 2 },
  })
})

test('a record is bounded: a write past LAYOUT_LIMITS is refused and changes nothing', () => {
  const root = domainRoot()
  const many = (count: number, from = 0) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`class.C${from + index}`, { x: 0, y: 0 }]),
    )
  expect('value' in setLensPositions(root, 'structure', many(LAYOUT_LIMITS.positions))).toBe(true)
  // one more box, in a later write, is past the lens's bound
  expect(setLensPositions(root, 'structure', many(1, LAYOUT_LIMITS.positions))).toEqual({
    problem: `the arrangements of the lens structure place more than ${LAYOUT_LIMITS.positions} boxes`,
    tooLarge: true,
  })
  expect(Object.keys(readLayout(root).lenses!.structure!)).toHaveLength(LAYOUT_LIMITS.positions)

  const lenses = Array.from({ length: LAYOUT_LIMITS.lenses }, (_, index) => `lens-${index}`)
  const other = domainRoot()
  for (const lens of lenses) setLensPositions(other, lens, many(1))
  expect(setLensPositions(other, 'one-more', many(1))).toEqual({
    problem: `its arrangements name more than ${LAYOUT_LIMITS.lenses} lenses`,
    tooLarge: true,
  })
  const far = setLensPositions(other, 'lens-0', {
    'class.Far': { x: LAYOUT_LIMITS.coordinate + 1, y: 0 },
  })
  expect('problem' in far && far.problem).toBe(
    `the box class.Far stands at no x and y within ${LAYOUT_LIMITS.coordinate} of 0`,
  )
})

test('shutting and opening adds and removes ids: two tabs each shutting a module both stand', () => {
  const root = domainRoot()
  changeLensIds(root, 'collapsed', 'structure', { add: ['module.billing'], remove: [] })
  // the other tab, which never saw billing shut, shuts fleet
  changeLensIds(root, 'collapsed', 'structure', { add: ['module.fleet'], remove: [] })
  expect(readLayout(root).collapsed).toEqual({ structure: ['module.billing', 'module.fleet'] })
  changeLensIds(root, 'collapsed', 'structure', { add: [], remove: ['module.billing'] })
  changeLensIds(root, 'opened', 'rules', { add: ['class.A#call'], remove: ['class.B#read'] })
  expect(readLayout(root)).toEqual({
    collapsed: { structure: ['module.fleet'] },
    opened: { rules: ['class.A#call'] },
  })
})

test('each lens keeps its own shut modules and opened folds, through an automatic layout of its boxes', () => {
  const root = domainRoot()
  setLensPositions(root, 'behavior', { 'class.A': { x: 10, y: 20 } })
  changeLensIds(root, 'collapsed', 'behavior', {
    add: ['module.billing', 'module.fleet'],
    remove: [],
  })
  changeLensIds(root, 'collapsed', 'structure', { add: [], remove: ['module.billing'] })
  changeLensIds(root, 'opened', 'rules', { add: ['class.Invoice#call'], remove: [] })
  // A later write changes only what it names: the module it removes is open again.
  changeLensIds(root, 'collapsed', 'behavior', { add: [], remove: ['module.billing'] })
  expect(readLayout(root).collapsed).toEqual({ behavior: ['module.fleet'], structure: [] })
  expect(readLayout(root).opened).toEqual({ rules: ['class.Invoice#call'] })

  // Laying the boxes out automatically again leaves which modules and folds are open as they were.
  setLensPositions(root, 'rules', { 'class.Invoice': { x: 1, y: 2 } })
  resetLensLayout(root, 'rules')
  expect(resetLensLayout(root, 'behavior')).toEqual({
    collapsed: { behavior: ['module.fleet'], structure: [] },
    opened: { rules: ['class.Invoice#call'] },
  })
  resetLayout(root)
  expect(readLayout(root)).toEqual({})
})
