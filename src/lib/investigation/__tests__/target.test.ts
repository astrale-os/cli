import { expect, test } from 'bun:test'

import { investigationTarget } from '../target'
const issuer = 'https://instance.test/api'
const store = {
  active: 'unrelated',
  instances: {
    selected: { url: issuer, defaultIdentity: 'human', operatorIdentity: 'operator' },
    unrelated: { url: 'https://other.test' },
  },
}
test('selects exact issuer and preconfigured operator, preserving explicit authority choices', () => {
  expect(investigationTarget({}, issuer, store)).toEqual({ instance: 'selected', as: 'operator' })
  expect(investigationTarget({ as: 'explicit' }, issuer, store)).toEqual({
    instance: 'selected',
    as: 'explicit',
  })
  expect(investigationTarget({ creds: 'bearer' }, issuer, store)).toEqual({
    instance: 'selected',
    creds: 'bearer',
  })
  expect(investigationTarget({ anonymous: true }, issuer, store)).toEqual({
    instance: 'selected',
    anonymous: true,
  })
  expect(() => investigationTarget({ instance: 'unrelated' }, issuer, store)).toThrow(
    'does not match',
  )
  expect(investigationTarget({}, 'https://new.test', store)).toEqual({ url: 'https://new.test' })
})
test('ambiguous bookmarks require selection before using any authority', () => {
  expect(() =>
    investigationTarget({}, issuer, {
      ...store,
      instances: { ...store.instances, alias: store.instances.selected },
    }),
  ).toThrow('Multiple bookmarks')
})
