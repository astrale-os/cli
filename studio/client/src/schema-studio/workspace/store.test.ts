import { expect, test } from 'bun:test'

import { selectionForActiveDomain, uniqueDomainIds } from './store'

test('normalizes workspace domain selections without reordering them', () => {
  expect(uniqueDomainIds(['services', 'kernel', 'services', '', 'shell'])).toEqual([
    'services',
    'kernel',
    'shell',
  ])
})

test('switches a single-domain canvas without accidentally enabling composition', () => {
  expect(selectionForActiveDomain(['services'], 'services', 'issues')).toEqual(['issues'])
})

test('keeps a composed canvas while changing or adding its active domain', () => {
  expect(selectionForActiveDomain(['services', 'issues'], 'services', 'issues')).toEqual([
    'services',
    'issues',
  ])
  expect(selectionForActiveDomain(['services', 'issues'], 'services', 'shell')).toEqual([
    'services',
    'issues',
    'shell',
  ])
})
