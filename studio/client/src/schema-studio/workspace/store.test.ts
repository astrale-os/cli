import { expect, test } from 'bun:test'

import { uniqueDomainIds } from './store'

test('normalizes workspace domain selections without reordering them', () => {
  expect(uniqueDomainIds(['services', 'kernel', 'services', '', 'shell'])).toEqual([
    'services',
    'kernel',
    'shell',
  ])
})
