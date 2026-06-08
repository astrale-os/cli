import { describe, expect, test } from 'bun:test'

import { basename, classNameOf } from '../ls'

// Regression: the formatter used to read `item.slug` (never returned by the
// kernel), blanking the name column and breaking `-q`/`-R`. The real fields are
// `path` (absolute) and `class` (serialized ClassPath).
describe('ls — display projection (slug-bug regression)', () => {
  test('basename derives the display name from the absolute path', () => {
    expect(basename('/dist.astrale.ai')).toBe('dist.astrale.ai')
    expect(basename('/kernel.astrale.ai')).toBe('kernel.astrale.ai')
    expect(basename('/')).toBe('/')
    expect(basename(undefined)).toBe('')
  })

  test('classNameOf parses the kind from the serialized class path', () => {
    expect(classNameOf({ class: '/:kernel.astrale.ai:class.Domain' })).toBe('Domain')
    expect(classNameOf({ class: '/:kernel.astrale.ai:class.Folder' })).toBe('Folder')
  })

  test('classNameOf falls back to the most specific label, then ?', () => {
    expect(classNameOf({ __labels: ['Node', 'Domain', 'Container'] })).toBe('Container')
    expect(classNameOf({})).toBe('?')
  })
})
