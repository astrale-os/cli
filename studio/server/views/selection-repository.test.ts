import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readRememberedTarget, rememberTarget } from './selection-repository'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('persists the remembered target through the view-owned repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-view-selection-'))
  roots.push(root)
  rememberTarget(root, 'staging', 'issue-detail', {
    id: 'issue-1',
    ref: '@issue-1',
    className: 'Issue',
    classOrigin: 'issues.example.dev',
    label: 'First issue',
  })

  expect(readRememberedTarget(root, 'staging', 'issue-detail')).toEqual({
    id: 'issue-1',
    className: 'Issue',
    classOrigin: 'issues.example.dev',
    label: 'First issue',
  })
})
