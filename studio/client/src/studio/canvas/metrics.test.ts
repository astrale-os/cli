import { describe, expect, test } from 'bun:test'

import { fitLines, LEGIBLE_TEXT, FONTS, namesIn, rulesLegible, type TextMeasure } from './metrics'

/** One unit per character, whatever the font: lines are as wide as their characters. */
const chars: TextMeasure = (text) => text.length

describe('a phrase in its lines', () => {
  const phrase = 'either it is reported by you, or you are a member of the project that holds it'

  test('fits whole where it can, broken between words', () => {
    expect(fitLines(phrase, 200, 3, chars)).toEqual([phrase])
    const lines = fitLines(phrase, 30, 3, chars)
    expect(lines).toEqual([
      'either it is reported by you,',
      'or you are a member of the',
      'project that holds it',
    ])
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30)
  })

  test('past its lines, ends after the words that still fit, never in its middle', () => {
    const lines = fitLines(phrase, 20, 3, chars)
    expect(lines).toHaveLength(3)
    expect(lines.at(-1)).toMatch(/…$/u)
    for (const line of lines) {
      expect(line).not.toMatch(/ … /u)
      expect(line.length).toBeLessThanOrEqual(20)
    }
    expect(phrase.startsWith(lines.join(' ').slice(0, -1))).toBe(true)
  })

  test('a cut never leaves a separator before its "…"', () => {
    expect(fitLines('read, write, delete, and more', 7, 1, chars)).toEqual(['read…'])
  })

  test('a word wider than the room stands alone on its line', () => {
    expect(fitLines('instance_runs_on_host · at most one', 10, 3, chars)[0]).toBe(
      'instance_runs_on_host',
    )
  })
})

describe('when rule phrases read', () => {
  const at = (pixels: number) => pixels / FONTS.ruleText.size

  test('from the size they read at; below it, a row is a mark', () => {
    expect(rulesLegible(at(LEGIBLE_TEXT.show), false)).toBe(true)
    expect(rulesLegible(at(LEGIBLE_TEXT.show) - 0.01, false)).toBe(false)
  })

  test('a zoom resting between the two sizes keeps what it showed', () => {
    const between = at((LEGIBLE_TEXT.show + LEGIBLE_TEXT.hide) / 2)
    expect(rulesLegible(between, true)).toBe(true)
    expect(rulesLegible(between, false)).toBe(false)
    expect(rulesLegible(at(LEGIBLE_TEXT.hide) - 0.01, true)).toBe(false)
  })
})

describe('the functions a rule row names', () => {
  const names = ['rename', 'archive', 'restore', 'transfer'].map((label) => ({
    id: `function.Host.${label}`,
    rule: `class.Host.method.${label}#call`,
    label,
  }))
  const labels = (shown: { label: string }[]) => shown.map((name) => name.label)

  test('in order, as many as fit, the rest counted', () => {
    const placed = namesIn(names, 'rename, archive, +2'.length, chars)
    expect(labels(placed.shown)).toEqual(['rename', 'archive'])
    expect(placed.more).toBe(2)
  })

  test('a lit one counted in "+N" is drawn by name, in its place among the others', () => {
    const room = 'rename, transfer, +2'.length
    const lit = namesIn(names, room, chars, (name) => name.label === 'transfer')
    expect(labels(lit.shown)).toEqual(['rename', 'transfer'])
    expect(lit.more).toBe(2)
    // however long it is, a lit name is drawn, alone if it must be
    const narrow = namesIn(names, 4, chars, (name) => name.label === 'transfer')
    expect(labels(narrow.shown)).toEqual(['transfer'])
  })
})
