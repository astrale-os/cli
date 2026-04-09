import { describe, expect, test } from 'bun:test'

import { validateName } from '../instance'

describe('validateName', () => {
  test('accepts valid names', () => {
    expect(() => validateName('manager', 'Instance')).not.toThrow()
    expect(() => validateName('my-instance', 'Instance')).not.toThrow()
    expect(() => validateName('my_instance', 'Instance')).not.toThrow()
    expect(() => validateName('my.instance', 'Instance')).not.toThrow()
    expect(() => validateName('Instance123', 'Instance')).not.toThrow()
    expect(() => validateName('a', 'Identity')).not.toThrow()
  })

  test('rejects empty string', () => {
    expect(() => validateName('', 'Instance')).toThrow(/Invalid instance name/)
  })

  test('rejects whitespace', () => {
    expect(() => validateName(' ', 'Instance')).toThrow(/Invalid instance name/)
    expect(() => validateName('my instance', 'Instance')).toThrow(/Invalid instance name/)
  })

  test('rejects special characters', () => {
    expect(() => validateName('my/instance', 'Instance')).toThrow(/Invalid instance name/)
    expect(() => validateName('my@instance', 'Identity')).toThrow(/Invalid identity name/)
    expect(() => validateName('name!', 'Instance')).toThrow()
  })

  test('includes entity type in error message', () => {
    expect(() => validateName('', 'Instance')).toThrow('instance')
    expect(() => validateName('', 'Identity')).toThrow('identity')
  })
})
