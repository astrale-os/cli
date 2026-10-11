import { expect, test } from 'bun:test'
import chalk from 'chalk'
import { stripVTControlCharacters as strip } from 'node:util'

import { panel, renderInstanceHero } from '../terminal/panel'

test('a panel frames lines of any width and color in one rounded box', () => {
  const lines = strip(
    panel(['short', chalk.bold.cyan.underline('https://my-app.eu.astrale.ai')]),
  ).split('\n')
  expect(new Set(lines.map((line) => line.length)).size).toBe(1)
  expect(lines[0]).toMatch(/╭.*╮/u)
  expect(lines.at(-1)).toMatch(/╰.*╯/u)
})

test('the instance hero puts the URL front and center', () => {
  const out = strip(renderInstanceHero('my-app', 'https://my-app.eu.astrale.ai'))
  expect(out).toContain('Your instance is live')
  expect(out).toContain('https://my-app.eu.astrale.ai')
})
