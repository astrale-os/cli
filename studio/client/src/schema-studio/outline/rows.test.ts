import { expect, test } from 'bun:test'

import type { OutlineNode } from './model'

import { ancestorsOf, moveFor, outlineRows, rowStartingWith, type OutlineRow } from './rows'

const leaf = (id: string, input: Partial<OutlineNode> = {}): OutlineNode => ({
  id,
  kind: 'class',
  label: id.split('/').at(-1)!,
  children: [],
  ...input,
})

const tree: OutlineNode[] = [
  {
    ...leaf('Billing', { kind: 'module', target: 'module.billing' }),
    children: [
      leaf('Billing/Invoice', { target: 'class.Invoice' }),
      {
        ...leaf('Billing/Ledger', { target: 'class.Ledger' }),
        children: [leaf('Billing/Ledger/billed_to', { kind: 'link', target: 'class.billed_to' })],
      },
    ],
  },
  {
    ...leaf('People', { kind: 'module', target: 'module.people' }),
    children: [
      {
        ...leaf('People/Person', { target: 'class.Person' }),
        children: [
          leaf('People/Person/billed_to', {
            kind: 'link',
            target: 'class.billed_to',
            reference: true,
          }),
        ],
      },
    ],
  },
]

const modulesOpen = (node: OutlineNode) => node.kind === 'module'
const ids = (rows: OutlineRow[]) => rows.map((row) => row.node.id)

test('rows walk the open nodes depth first, with their ARIA position', () => {
  const rows = outlineRows(tree, { isExpanded: modulesOpen })
  expect(ids(rows)).toEqual([
    'Billing',
    'Billing/Invoice',
    'Billing/Ledger',
    'People',
    'People/Person',
  ])
  expect(rows[2]).toMatchObject({
    level: 2,
    parentId: 'Billing',
    position: 2,
    setSize: 2,
    expandable: true,
    expanded: false,
  })
  expect(rows[1]).toMatchObject({ expandable: false, expanded: false })
})

test('the home row of the selection is selected; its references are only current', () => {
  const rows = outlineRows(tree, { isExpanded: () => true, selected: 'class.billed_to' })
  const flags = rows
    .filter((row) => row.selected || row.current)
    .map((row) => [row.node.id, row.selected, row.current])
  expect(flags).toEqual([
    ['Billing/Ledger/billed_to', true, false],
    ['People/Person/billed_to', false, true],
  ])
  expect(ancestorsOf(tree, 'class.billed_to')?.map((node) => node.id)).toEqual([
    'Billing',
    'Billing/Ledger',
  ])
})

test('a filter keeps the matches and opens their ancestors, whatever was folded', () => {
  const rows = outlineRows(tree, { isExpanded: () => false, filter: ' BILLED ' })
  expect(ids(rows)).toEqual([
    'Billing',
    'Billing/Ledger',
    'Billing/Ledger/billed_to',
    'People',
    'People/Person',
    'People/Person/billed_to',
  ])
  expect(rows.find((row) => row.node.id === 'Billing/Ledger')).toMatchObject({
    position: 1,
    setSize: 1,
    expanded: true,
  })
})

test('the ARIA tree keys walk, fold, jump and select', () => {
  const rows = outlineRows(tree, { isExpanded: modulesOpen })
  expect(moveFor(rows, 'Billing', 'ArrowDown')).toEqual({ focus: 'Billing/Invoice' })
  expect(moveFor(rows, 'Billing', 'ArrowUp')).toBeUndefined()
  // right opens a closed row, then enters it
  expect(moveFor(rows, 'Billing/Ledger', 'ArrowRight')).toEqual({ expand: 'Billing/Ledger' })
  expect(moveFor(rows, 'Billing', 'ArrowRight')).toEqual({ focus: 'Billing/Invoice' })
  expect(moveFor(rows, 'Billing/Invoice', 'ArrowRight')).toBeUndefined()
  // left closes an open row, else climbs to the parent
  expect(moveFor(rows, 'Billing', 'ArrowLeft')).toEqual({ collapse: 'Billing' })
  expect(moveFor(rows, 'Billing/Invoice', 'ArrowLeft')).toEqual({ focus: 'Billing' })
  expect(moveFor(rows, 'People/Person', 'Home')).toEqual({ focus: 'Billing' })
  expect(moveFor(rows, 'Billing', 'End')).toEqual({ focus: 'People/Person' })
  expect(moveFor(rows, 'People/Person', 'Enter')).toEqual({ select: 'People/Person' })
  expect(moveFor(rows, 'Billing/Invoice', '*')).toEqual({ expandSiblings: ['Billing/Ledger'] })
  // a focus that went away starts over at the first row
  expect(moveFor(rows, 'gone', 'ArrowDown')).toEqual({ focus: 'Billing' })
})

test('type-ahead cycles on one letter and narrows on several', () => {
  const rows = outlineRows(tree, { isExpanded: modulesOpen })
  expect(rowStartingWith(rows, 'Billing', 'p')).toBe('People')
  expect(rowStartingWith(rows, 'People', 'p')).toBe('People/Person')
  expect(rowStartingWith(rows, 'People', 'pe')).toBe('People')
  expect(rowStartingWith(rows, 'People', 'per')).toBe('People/Person')
  expect(rowStartingWith(rows, 'People', 'x')).toBeUndefined()
})
