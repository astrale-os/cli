/**
 * A part of a rule's reading as one phrase for a card row: the words of a node of the Text
 * (`f/condition`), from its first to its last, with the words of the nodes around it they sit
 * between — as `phraseOf` reads them — and each block of an outline after the first joined to
 * the one before it by a space, so a list reads `all of the following hold: you are …; you
 * administer …` on one line. A note is never part of a phrase.
 */

import type { Block, Run, Text } from '@astrale-os/visual'

/** The Text's runs in reading order, each marked when it opens a block. */
function runsOf(blocks: readonly Block[]): { run: Run; opens: boolean }[] {
  const runs: { run: Run; opens: boolean }[] = []
  const add = (list: readonly Run[]) =>
    list.forEach((run, index) => runs.push({ run, opens: index === 0 }))
  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      if (block.kind === 'paragraph') add(block.runs)
      else {
        add(block.lead)
        for (const item of block.items) walk(item)
      }
    }
  }
  walk(blocks)
  return runs
}

/** The words of `node` as one phrase, or undefined when the Text says nothing of it. */
export function phraseIn(text: Text, node: string): string | undefined {
  const under = (id: string) => {
    for (let at: string | undefined = id; at !== undefined; at = text.nodes[at]?.parent)
      if (at === node) return true
    return false
  }
  const runs = runsOf(text.blocks)
  const said = (run: Run) =>
    !run.modifiers?.includes('note') && run.parts.some((part) => !part.unsaid && under(part.node))
  const first = runs.findIndex(({ run }) => said(run))
  if (first < 0) return undefined
  let last = first
  for (let index = runs.length - 1; index > first; index -= 1)
    if (said(runs[index]!.run)) {
      last = index
      break
    }
  const words = runs
    .slice(first, last + 1)
    .map(({ run, opens }, index) => (index > 0 && opens ? ` ${run.text}` : run.text))
    .join('')
  const phrase = words.replace(/\s+/gu, ' ').replace(/^[\s,;:]+|[\s,;:.]+$/gu, '')
  return phrase.length > 0 ? phrase : undefined
}
