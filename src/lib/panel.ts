import chalk from 'chalk'

import { visibleWidth } from './format'

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' } as const

export type PanelOpts = {
  /** Colorize the box border (default: cyan). */
  borderColor?: (s: string) => string
  /** Horizontal padding inside the box (default: 3). */
  padX?: number
  /** Left margin in spaces for the whole box (default: 2). */
  margin?: number
}

/**
 * Draw a rounded box around pre-styled lines. Widths are computed on *visible*
 * length so embedded ANSI (bold/color/underline) never breaks alignment. The
 * lines are passed in already colored — `panel` only frames them.
 */
export function panel(lines: string[], opts: PanelOpts = {}): string {
  const padX = opts.padX ?? 3
  const margin = ' '.repeat(opts.margin ?? 2)
  const border = opts.borderColor ?? chalk.cyan
  const inner = Math.max(0, ...lines.map(visibleWidth))
  const span = inner + padX * 2

  const top = margin + border(BOX.tl + BOX.h.repeat(span) + BOX.tr)
  const bottom = margin + border(BOX.bl + BOX.h.repeat(span) + BOX.br)
  const body = lines.map((line) => {
    const fill = ' '.repeat(inner - visibleWidth(line))
    return (
      margin + border(BOX.v) + ' '.repeat(padX) + line + fill + ' '.repeat(padX) + border(BOX.v)
    )
  })
  return [top, ...body, bottom].join('\n')
}

/**
 * The consent gate for a destructive action: the same rounded frame as every
 * other panel, in red. Hand-drawn `│` gutters used to stand in for this, which
 * left the CLI with two different shapes for "read this before you answer".
 */
export function dangerPanel(title: string, lines: string[]): string {
  return panel([chalk.red.bold(`⚠  DANGER — ${title}`), '', ...lines], {
    borderColor: chalk.red,
  })
}

/**
 * The provisioned-instance hero: a bright, click-inviting panel that puts the
 * fresh instance URL front and center. Rendered only in interactive (human)
 * mode — machine output carries the URL in its JSON instead.
 */
export function renderInstanceHero(slug: string, url: string): string {
  return panel(
    [
      `${chalk.green('✦')}  ${chalk.bold('Your instance is live')}`,
      '',
      `   ${chalk.bold.cyan.underline(url)}`,
      '',
      chalk.dim(`   ${slug} · ⌘-click the link or paste it into your browser`),
    ],
    { borderColor: chalk.cyan },
  )
}
