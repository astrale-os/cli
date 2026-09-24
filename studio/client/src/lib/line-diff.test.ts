import { expect, test } from 'bun:test'

import { lineDiff } from './line-diff'

const signs = (before: string | undefined, after: string) =>
  lineDiff(before, after).map(
    (line) => `${{ same: ' ', removed: '-', added: '+' }[line.kind]}${line.text}`,
  )

test('an edit keeps its context and marks only what changed', () => {
  expect(
    signs(
      'props: {\n  name: z.string(),\n}',
      'props: {\n  name: z.string(),\n  email: z.string(),\n}',
    ),
  ).toEqual([' props: {', '   name: z.string(),', '+  email: z.string(),', ' }'])
})

test('a replaced line reads as removed, then added', () => {
  expect(signs('a\nold\nc', 'a\nnew\nc')).toEqual([' a', '-old', '+new', ' c'])
})

test('lines that moved around a change are still found in common', () => {
  expect(signs('x\na\nb\ny', 'x\nb\na\nb\ny')).toEqual([' x', '+b', ' a', ' b', ' y'])
})

test('a new file is every line added; an emptied one every line removed', () => {
  expect(signs(undefined, 'one\ntwo')).toEqual(['+one', '+two'])
  expect(signs('one\ntwo', '')).toEqual(['-one', '-two'])
})

test('a middle too large to align still says everything that changed', () => {
  const before = Array.from({ length: 600 }, (_, index) => `old ${index}`).join('\n')
  const after = Array.from({ length: 600 }, (_, index) => `new ${index}`).join('\n')
  const diff = lineDiff(`head\n${before}\ntail`, `head\n${after}\ntail`)

  expect(diff[0]).toEqual({ kind: 'same', text: 'head' })
  expect(diff.at(-1)).toEqual({ kind: 'same', text: 'tail' })
  expect(diff.filter((line) => line.kind === 'removed')).toHaveLength(600)
  expect(diff.filter((line) => line.kind === 'added')).toHaveLength(600)
})
