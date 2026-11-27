import { describe, expect, test } from 'bun:test'

import type { ChangeSet } from '../../shared/contracts/workspace'

import { changeText, schemaChangeDigest } from './service'

const NOTICE =
  'Indicative source/structure diff only; the Kernel Runtime has not assessed installation or data migration.'

const changeSet = (schema: ChangeSet['schema'], extra: Partial<ChangeSet> = {}): ChangeSet => ({
  source: 'baseline',
  hasGit: false,
  hasBaseline: true,
  schema,
  fileChanges: [],
  ...extra,
})

describe('the handoff says what the Schema comparison is', () => {
  const unread = { state: 'unread', reason: 'schema/index.ts: Unexpected token.' } as const

  test('an unread Schema says it cannot be read and why, never "no schema changes"', () => {
    expect(schemaChangeDigest(changeSet(unread))).toBe(
      'The Schema cannot be read, so nothing is compared: schema/index.ts: Unexpected token.',
    )
    // under Git too: the diff is still listed, after the Schema's state
    expect(
      changeText(
        changeSet(unread, {
          source: 'git',
          hasGit: true,
          schemaDiffText: 'diff --git a/schema/index.ts b/schema/index.ts',
        }),
      ),
    ).toBe(
      [
        NOTICE,
        'The Schema cannot be read, so nothing is compared: schema/index.ts: Unexpected token.',
        'diff --git a/schema/index.ts b/schema/index.ts',
      ].join('\n'),
    )
  })

  test('an unchanged Schema says none, and the files that changed are still listed', () => {
    const unchanged = changeSet(
      { state: 'unchanged' },
      { fileChanges: [{ file: 'views/risk/index.ts', status: 'modified' }] },
    )
    expect(schemaChangeDigest(unchanged)).toBe('no schema changes since baseline')
    expect(changeText(unchanged)).toBe(`${NOTICE}\n~ modified views/risk/index.ts`)
    expect(changeText(changeSet({ state: 'unchanged' }))).toBe('')
  })

  test('a changed Schema lists each change', () => {
    const changed = changeSet({
      state: 'changed',
      changes: [{ kind: 'class-added', target: 'Invoice' }],
    })
    expect(schemaChangeDigest(changed)).toBe(
      'Indicative only; Runtime compatibility was not assessed.\nSTRUCTURAL class-added Invoice',
    )
    expect(changeText(changed)).toBe(`${NOTICE}\n~ class-added Invoice`)
  })
})
