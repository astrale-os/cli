import { publishedDomainId } from '@shared/contracts/versions'
import { KERNEL_DOMAIN_ID } from '@shared/contracts/workspace'
import { expect, test } from 'bun:test'

import { readOnlyNotice } from './read-only'

const PUBLICATION = publishedDomainId('payments.example.dev', '1.1.0')

test('a Domain of the Workspace takes comments and Ask edits: no notice', () => {
  expect(readOnlyNotice('crm-1a2b3c4d', 'comment')).toBeUndefined()
  expect(readOnlyNotice('crm-1a2b3c4d', 'ask')).toBeUndefined()
})

test('the Kernel and every Publication are read-only, each in its own words', () => {
  expect(readOnlyNotice(PUBLICATION, 'comment')).toBe(
    'A Publication is read-only: there is no thread to start on it. Ask (A) about it instead.',
  )
  expect(readOnlyNotice(KERNEL_DOMAIN_ID, 'comment')).toBe(
    'The Kernel is read-only: comment on your own Domains, or Ask (A) about it.',
  )
  // Ask still answers about both; it says it edits nothing of them
  expect(readOnlyNotice(PUBLICATION, 'ask')).toBe(
    'A Publication is read-only: Ask answers from its Schema and changes no file.',
  )
  expect(readOnlyNotice(KERNEL_DOMAIN_ID, 'ask')).toBe(
    'The Kernel is read-only: Ask answers from its Schema and changes no file.',
  )
})
