import { expect, test } from 'bun:test'

import { dataEntries, displayName } from '../names'

test('presents canonical property keys without losing ambiguous identities', () => {
  const node = {
    path: '/:documents.example.dev:core.welcome',
    data: {
      'documents.example.dev:class.Document.property.name': 'Welcome',
      'metadata.example.dev:interface.Labelled.property.label': 'Primary',
      'legacy.example.dev:interface.Labelled.property.label': 'Legacy',
      healthy: true,
    },
  }

  expect(displayName(node)).toBe('Welcome')
  // a unique property name reads short; two that collide keep their full identity
  expect(dataEntries(node.data).map(({ label }) => label)).toEqual([
    'name',
    'metadata.example.dev:interface.Labelled.property.label',
    'legacy.example.dev:interface.Labelled.property.label',
    'healthy',
  ])
})

test('a Node with no name or title is named by its path', () => {
  expect(displayName({ path: '/:documents.example.dev:core.welcome', data: { name: '' } })).toBe(
    ':documents.example.dev:core.welcome',
  )
})
