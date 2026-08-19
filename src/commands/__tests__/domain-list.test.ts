import { describe, expect, test } from 'bun:test'

import type { DomainInfo } from '../../lib/admin-domain'

import { byDefaultThenName, domainProjection, type DomainRow } from '../domain/list'

const strip = (s: string): string => s.replace(/\[[0-9;]*m/g, '')

function entry(over: Partial<DomainInfo>): DomainInfo {
  return {
    id: over.origin ?? 'id',
    origin: 'x.astrale.ai',
    name: 'x',
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

describe('domain list — ordering', () => {
  test('install-by-default sorts first, then alphabetical by origin', () => {
    const rows = [
      entry({ origin: 'zeta.astrale.ai' }),
      entry({ origin: 'alpha.astrale.ai' }),
      entry({ origin: 'mid.astrale.ai', installByDefault: true }),
      entry({ origin: 'beta.astrale.ai', installByDefault: true }),
    ]
    rows.sort(byDefaultThenName)
    expect(rows.map((r) => r.origin)).toEqual([
      'beta.astrale.ai', // default group, alpha order
      'mid.astrale.ai',
      'alpha.astrale.ai', // non-default group, alpha order
      'zeta.astrale.ai',
    ])
  })
})

describe('domain list — projection', () => {
  test('row carries name/origin/url and a default marker; -q paths are install urls', () => {
    const proj = domainProjection([
      entry({
        origin: 'crm.acme.dev',
        name: 'crm',
        url: 'https://crm.acme.dev',
        installByDefault: true,
      }),
    ])
    const row = proj.rows[0]
    expect(strip(row.name)).toBe('crm')
    expect(strip(row.origin)).toBe('crm.acme.dev')
    expect(strip(row.url)).toBe('https://crm.acme.dev')
    expect(strip(row.default)).toBe('default')
    // The quiet/pipeable token is the install URL, not the origin.
    expect(proj.paths).toEqual(['https://crm.acme.dev'])
  })

  test('an unpublished entry shows a placeholder url and falls back to origin for -q', () => {
    const proj = domainProjection([entry({ origin: 'pending.dev', name: 'pending' })])
    expect(strip(proj.rows[0].url)).toBe('(unpublished)')
    expect(strip(proj.rows[0].default)).toBe('')
    expect(proj.paths).toEqual(['pending.dev'])
  })

  test('STATUS cell is empty without --check, live/down with it', () => {
    const base = entry({ origin: 'a.dev', url: 'https://a.dev' })
    expect(strip(domainProjection([base]).rows[0].status)).toBe('')

    const live: DomainRow = { ...base, reachable: true, checkError: null }
    expect(strip(domainProjection([live]).rows[0].status)).toBe('● live')

    const down: DomainRow = { ...base, reachable: false, checkError: 'meta HTTP 502' }
    expect(strip(domainProjection([down]).rows[0].status)).toBe('○ meta HTTP 502')
  })
})
