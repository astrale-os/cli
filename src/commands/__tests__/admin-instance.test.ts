import { describe, expect, test } from 'bun:test'

import { ADMIN_INSTANCE } from '../../lib/admin-instance'

describe('admin-backed instance commands', () => {
  test('target the merged Instance class', () => {
    expect(ADMIN_INSTANCE).toBe('/admin.astrale.ai/class.Instance')
  })
})
