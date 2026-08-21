import { expect, test } from 'bun:test'

import type { ChangeSet } from '../../shared/types'

import { changeText } from './service'

test('labels schema changes as indicative structure rather than Runtime compatibility', () => {
  const changes: ChangeSet = {
    source: 'baseline',
    hasGit: false,
    hasBaseline: true,
    schemaChanges: [{ kind: 'class-removed', target: 'Legacy' }],
    fileChanges: [],
    structuralStatus: 'changed',
  }

  const text = changeText(changes)
  expect(text).toContain('Indicative source/structure diff only')
  expect(text).toContain('~ class-removed Legacy')
  expect(text).not.toContain('BREAKING')
  expect(text).not.toContain('additive')
})
