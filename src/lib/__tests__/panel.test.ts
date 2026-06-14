import { describe, expect, test } from 'bun:test'
import chalk from 'chalk'

import { panel, renderInstanceHero } from '../panel'

// Built from a char code so the regex source carries no literal control char.
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

describe('panel — rounded box framing', () => {
  test('every visible line is the same width (ANSI excluded)', () => {
    const lines = stripAnsi(panel(['short', 'a much longer line here'])).split('\n')
    const widths = new Set(lines.map((l) => l.length))
    expect(widths.size).toBe(1)
  })

  test('draws rounded corners top and bottom', () => {
    const lines = stripAnsi(panel(['x'])).split('\n')
    expect(lines[0]).toContain('╭')
    expect(lines[0]).toContain('╮')
    expect(lines[lines.length - 1]).toContain('╰')
    expect(lines[lines.length - 1]).toContain('╯')
  })

  test('colored content does not break alignment', () => {
    // A bold/underlined cell carries ANSI; visible width must still align.
    const out = panel(['plain', chalk.bold.cyan.underline('https://my-app.eu.astrale.ai')])
    const lines = stripAnsi(out).split('\n')
    expect(new Set(lines.map((l) => l.length)).size).toBe(1)
  })
})

describe('renderInstanceHero', () => {
  test('puts the URL front and center', () => {
    const out = stripAnsi(renderInstanceHero('my-app', 'https://my-app.eu.astrale.ai'))
    expect(out).toContain('Your instance is live')
    expect(out).toContain('https://my-app.eu.astrale.ai')
    expect(out).toContain('my-app')
  })
})
