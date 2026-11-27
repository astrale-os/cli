import type { Block, Run, Text } from '@astrale-os/visual'

import { describe, expect, test } from 'bun:test'

import { phraseIn } from './rule-phrase'

const run = (text: string, node: string, extra: Partial<Run> = {}): Run =>
  ({ text, parts: [{ node, role: 'word' }], ...extra }) as unknown as Run

/**
 * "You may read a ticket exactly when all of the following hold: you are a member; you
 * administer the fleet (a note)." — the condition an outline of two items.
 */
const reading = (): Text => {
  const blocks: Block[] = [
    {
      kind: 'list',
      node: 'f/condition',
      connective: 'and',
      lead: [
        run('You may read a ticket exactly when ', 'f'),
        run('all of the following hold:', 'f/condition'),
      ],
      items: [
        [
          {
            kind: 'paragraph',
            runs: [run('you are a member', 'f/condition/0'), run(';', 'f/condition')],
          },
        ],
        [
          {
            kind: 'paragraph',
            runs: [
              run('you administer the fleet', 'f/condition/1'),
              run(' (a note)', 'f/condition/1', { modifiers: ['note'] }),
              run('.', 'f'),
            ],
          },
        ],
      ],
    },
  ]
  return {
    format: 'astrale.text/1',
    nodes: {
      f: { kind: 'formula' },
      'f/condition': { parent: 'f', kind: 'formula' },
      'f/condition/0': { parent: 'f/condition', kind: 'formula' },
      'f/condition/1': { parent: 'f/condition', kind: 'formula' },
    },
    blocks,
  } as unknown as Text
}

describe("a rule's phrase for a card row", () => {
  test('an outline reads on one line, each item after the one before it, punctuated', () => {
    expect(phraseIn(reading(), 'f/condition')).toBe(
      'all of the following hold: you are a member; you administer the fleet',
    )
  })

  test('a part of the reading reads its own words only, never a note', () => {
    expect(phraseIn(reading(), 'f/condition/1')).toBe('you administer the fleet')
    expect(phraseIn(reading(), 'f/condition/0')).toBe('you are a member')
  })

  test('a node the reading says nothing of has no phrase', () => {
    expect(phraseIn(reading(), 'f/elsewhere')).toBeUndefined()
  })
})
