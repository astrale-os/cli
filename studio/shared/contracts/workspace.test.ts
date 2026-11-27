import { expect, test } from 'bun:test'

import { publishedDomainId } from './versions'
import {
  domainAddressOf,
  isReadOnlyDomainId,
  KERNEL_DOMAIN_ID,
  WORKSPACE_MAP_ID,
} from './workspace'

test('one reading says what every Domain id names', () => {
  expect(domainAddressOf('crm-1a2b3c4d')).toEqual({ kind: 'workspace', id: 'crm-1a2b3c4d' })
  expect(domainAddressOf('my.domain_v2-00ff00ff')).toEqual({
    kind: 'workspace',
    id: 'my.domain_v2-00ff00ff',
  })
  expect(domainAddressOf(KERNEL_DOMAIN_ID)).toEqual({ kind: 'kernel' })
  expect(domainAddressOf(publishedDomainId('issues.astrale.ai', '0.9.0'))).toEqual({
    kind: 'publication',
    origin: 'issues.astrale.ai',
    version: '0.9.0',
  })
  for (const id of [
    '',
    'crm',
    'crm-1A2B3C4D',
    'crm-1a2b3c4',
    `${'a'.repeat(41)}-1a2b3c4d`,
    'crm/x-1a2b3c4d',
    '@kernel2',
    WORKSPACE_MAP_ID,
    '@registry:issues.astrale.ai',
    '@registry:--json@0.9.0',
    '@registry:issues.astrale.ai@latest',
  ])
    expect(domainAddressOf(id)).toEqual({ kind: 'invalid' })
})

test('read-only is derived from the reading: the Kernel and a Publication, nothing else', () => {
  expect(isReadOnlyDomainId(KERNEL_DOMAIN_ID)).toBe(true)
  expect(isReadOnlyDomainId(publishedDomainId('issues.astrale.ai', '0.9.0'))).toBe(true)
  expect(isReadOnlyDomainId('crm-1a2b3c4d')).toBe(false)
  // an id that names nothing is no Domain to read; the server refuses every write to it
  expect(isReadOnlyDomainId('@registry:issues.astrale.ai')).toBe(false)
})
