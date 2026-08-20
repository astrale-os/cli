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
