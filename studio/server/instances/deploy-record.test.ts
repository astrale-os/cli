import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeJson } from '../state/store'
import { lastDeploy } from './deploy-record'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('reads the previous deploy fingerprint key but exposes only the current name', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-deploy-record-'))
  roots.push(root)
  writeJson(root, 'deploy.json', {
    at: '2026-08-20T00:00:00.000Z',
    schemaHash: 'sha-legacy',
    ok: true,
    url: 'https://notes.svc.example.astrale.ai',
  })

  expect(lastDeploy(root)).toEqual({
    at: '2026-08-20T00:00:00.000Z',
    renderFingerprint: 'sha-legacy',
    ok: true,
    url: 'https://notes.svc.example.astrale.ai',
  })
})
