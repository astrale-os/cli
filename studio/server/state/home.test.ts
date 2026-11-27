import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { domainAddressOf } from '../../shared/contracts/workspace'
import { workspaceKey } from './home'

test('every project key reads back as a workspace Domain id', () => {
  for (const folder of ['crm', 'Décisions', 'a b c', '@@', '.hidden', 'x'.repeat(80), '中文']) {
    const id = workspaceKey(join('/tmp/projects', folder))
    expect(domainAddressOf(id)).toEqual({ kind: 'workspace', id })
  }
})
