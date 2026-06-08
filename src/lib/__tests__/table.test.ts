import { describe, expect, test } from 'bun:test'

import { renderTable } from '../table'

const ESC = String.fromCharCode(27)
const strip = (s: string): string => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')

const COLS = [
  { key: 'name', header: 'NAME' },
  { key: 'kind', header: 'KIND' },
]

describe('renderTable', () => {
  test('aligns the KIND column across rows of different name widths', () => {
    const out = strip(
      renderTable(
        [
          { name: 'dist.astrale.ai', kind: 'Domain' },
          { name: 'workspace', kind: 'Folder' },
        ],
        { columns: COLS },
      ),
    )
    const [a, b] = out.split('\n')
    expect(a.indexOf('Domain')).toBe(b.indexOf('Folder'))
  })

  test('empty rows render as (empty)', () => {
    expect(strip(renderTable([], { columns: COLS }))).toContain('(empty)')
  })

  test('drops a column that is empty across every row (with header)', () => {
    const out = strip(renderTable([{ name: 'a', kind: '' }], { columns: COLS, showHeader: true }))
    expect(out).toContain('NAME')
    expect(out).not.toContain('KIND')
  })

  test('computes width on visible length, ignoring ANSI in cells', () => {
    const colored = `${ESC}[32mok${ESC}[39m`
    const out = strip(
      renderTable(
        [
          { name: colored, kind: 'x' },
          { name: 'wider-name', kind: 'y' },
        ],
        { columns: COLS },
      ),
    )
    const [a, b] = out.split('\n')
    // KIND aligns despite the ANSI codes that were in row 0's name cell.
    expect(a.indexOf('x')).toBe(b.indexOf('y'))
  })
})
