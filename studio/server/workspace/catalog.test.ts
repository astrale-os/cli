import { expect, test } from 'bun:test'

import { buildCatalog } from './catalog'

test('workspace catalog contains only discovered domains and never simulated import authorities', () => {
  const catalog = buildCatalog([
    { origin: 'issues.example.dev', id: 'issues' },
    { origin: 'billing.example.dev', id: 'billing-service' },
  ])

  expect(catalog.map(({ origin, kind }) => ({ origin, kind }))).toEqual([
    { origin: 'kernel.astrale.ai', kind: 'kernel' },
    { origin: 'issues.example.dev', kind: 'local' },
    { origin: 'billing.example.dev', kind: 'local' },
  ])
  expect(catalog.some((entry) => entry.kind === 'external')).toBe(false)
})
