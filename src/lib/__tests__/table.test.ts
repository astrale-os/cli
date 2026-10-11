import { expect, test } from 'bun:test'
import { stripVTControlCharacters as strip } from 'node:util'

import { renderTable } from '../terminal/table'

const COLS = [
  { key: 'name', header: 'NAME' },
  { key: 'kind', header: 'KIND' },
]

test('renderTable aligns columns on visible width, ANSI in cells aside', () => {
  const rows = [
    { name: '\u001b[32mok\u001b[39m', kind: 'Domain' },
    { name: 'example.astrale.ai', kind: 'Folder' },
  ]
  const [a, b] = strip(renderTable(rows, { columns: COLS })).split('\n')
  expect(a!.indexOf('Domain')).toBe(b!.indexOf('Folder'))
})

test('renderTable drops a column empty in every row, and shows an empty table as (empty)', () => {
  const out = strip(renderTable([{ name: 'a', kind: '' }], { columns: COLS, showHeader: true }))
  expect(out).toContain('NAME')
  expect(out).not.toContain('KIND')
  expect(strip(renderTable([], { columns: COLS }))).toContain('(empty)')
})
