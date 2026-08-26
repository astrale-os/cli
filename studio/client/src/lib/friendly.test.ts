import { expect, test } from 'bun:test'

import { friendlyType } from './friendly'

test('keeps canonical optionality separate from nullable value schemas', () => {
  expect(friendlyType({ type: 'string' }, true)).toMatchObject({
    label: 'Text',
    optional: true,
  })
  expect(friendlyType({ type: ['string', 'null'] }, false)).toMatchObject({
    label: 'Text',
    optional: false,
  })
})

test('recognizes the DSL Node path value schema as a reference', () => {
  expect(
    friendlyType({
      $ref: 'https://schemas.astrale.ai/graph/1/node-path',
      'x-astrale-path': {
        target: 'node',
        cardinality: 'one',
        accepts: [{ origin: 'example.test', kind: 'class', name: 'Issue' }],
      },
    }),
  ).toMatchObject({ label: 'Reference' })
})
