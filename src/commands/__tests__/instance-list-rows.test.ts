import { describe, expect, test } from 'bun:test'

import type { InstanceInfo } from '../../lib/admin-instance'

import { buildInstanceRows, type Bookmark } from '../instance/list'

const managed: InstanceInfo[] = [
  { id: 'demo', slug: 'demo', url: 'https://demo.eu.astrale.ai', state: 'ready' },
]

function bookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    name: 'demo',
    url: 'https://demo.eu.astrale.ai/api',
    issuer: null,
    active: false,
    defaultIdentity: null,
    caFile: null,
    createdAt: null,
    ...overrides,
  }
}

describe('buildInstanceRows', () => {
  test('a bookmark of a managed instance does not produce a second row', () => {
    const rows = buildInstanceRows(managed, [bookmark()], { managed: true, bookmarks: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'managed' })
  })

  test('the active marker moves onto the merged managed row', () => {
    const rows = buildInstanceRows(managed, [bookmark({ active: true })], {
      managed: true,
      bookmarks: true,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toContain('*')
  })

  test('a same-name bookmark with a different URL stays a separate row', () => {
    const rows = buildInstanceRows(managed, [bookmark({ url: 'https://elsewhere.example.com' })], {
      managed: true,
      bookmarks: true,
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.kind)).toEqual(['managed', 'bookmark'])
  })

  test('unrelated bookmarks are listed as before', () => {
    const rows = buildInstanceRows(
      managed,
      [bookmark(), bookmark({ name: 'local', url: 'http://localhost:3001/api' })],
      { managed: true, bookmarks: true },
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.name)).toEqual(['demo', 'local'])
  })

  test('--bookmarked never merges (managed hidden)', () => {
    const rows = buildInstanceRows(managed, [bookmark()], { managed: false, bookmarks: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'bookmark' })
  })
})
