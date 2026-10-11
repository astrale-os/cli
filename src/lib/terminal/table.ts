import chalk from 'chalk'

import { visibleWidth } from './format'

/** A display column: which row key to read, its header, and an optional cell color. */
export type Column = { key: string; header: string; color?: (s: string) => string }

const GUTTER = '  '

/** Pad to a target *visible* width (color codes don't count toward length). */
function pad(s: string, width: number): string {
  const diff = width - visibleWidth(s)
  return diff > 0 ? s + ' '.repeat(diff) : s
}

/**
 * Render an aligned, optionally-colored table.
 *
 * Cells may carry ANSI (e.g. a per-row status color) — widths are computed on
 * visible length so alignment stays correct. `Column.color` colors a whole
 * column of otherwise-plain cells. Columns empty across every row are dropped;
 * the last column is left unpadded so there's no trailing whitespace.
 */
export function renderTable(
  rows: Array<Record<string, string>>,
  opts: { columns: Column[]; showHeader?: boolean },
): string {
  if (rows.length === 0) return chalk.dim('  (empty)')

  const cols = opts.columns.filter((c) => rows.some((r) => (r[c.key] ?? '') !== ''))
  if (cols.length === 0) return chalk.dim('  (empty)')

  const widths = cols.map((c) =>
    Math.max(
      opts.showHeader ? c.header.length : 0,
      ...rows.map((r) => visibleWidth(r[c.key] ?? '')),
    ),
  )

  const line = (cell: (col: Column, i: number) => string): string =>
    '  ' + cols.map(cell).join(GUTTER).replace(/\s+$/, '')

  const lines: string[] = []
  if (opts.showHeader) {
    lines.push(line((c, i) => chalk.dim(pad(c.header, widths[i]))))
  }
  for (const r of rows) {
    lines.push(
      line((c, i) => {
        const raw = r[c.key] ?? ''
        const text = i === cols.length - 1 ? raw : pad(raw, widths[i])
        return c.color ? c.color(text) : text
      }),
    )
  }
  return lines.join('\n')
}
