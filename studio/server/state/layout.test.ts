import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { asJsonRecord } from '../json'
import { readLayout, saveLayout } from './layout'
import { readJson, writeJson } from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('reads the old layout hash key but writes only renderFingerprint', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-layout-'))
  roots.push(root)
  writeJson(root, 'layout.json', {
    schemaHash: 'sha-legacy',
    positions: { 'class.Note': { x: 1, y: 2 } },
  })

  expect(readLayout(root)).toEqual({
    renderFingerprint: 'sha-legacy',
    positions: { 'class.Note': { x: 1, y: 2 } },
  })

  saveLayout(root, { 'class.Note': { x: 3, y: 4 } }, 'sha-current')
  expect(readJson(root, 'layout.json', asJsonRecord, {})).toEqual({
    renderFingerprint: 'sha-current',
    positions: { 'class.Note': { x: 3, y: 4 } },
  })
})
