import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addDocument, listDocuments, migrateDocuments, readDocument } from './documents'
import { statePath, writeJson, writeStateBuffer } from './store'

const roots: string[] = []

function root(): string {
  const created = mkdtempSync(join(tmpdir(), 'studio-documents-'))
  roots.push(created)
  return created
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const bytes = (text: string) => new TextEncoder().encode(text)

test('a document is stored under a readable name, not its id', () => {
  const domain = root()
  const meta = addDocument(domain, 'Pricing Decisions.MD', 'text/markdown', bytes('# pricing'))

  expect(meta.stored).toBe('context/docs/pricing-decisions.md')
  expect(readFileSync(statePath(domain, meta.stored), 'utf8')).toBe('# pricing')
  expect(readDocument(domain, meta.id)?.meta.name).toBe('Pricing Decisions.MD')
})

test('same-named documents never overwrite each other', () => {
  const domain = root()
  const first = addDocument(domain, 'notes.md', 'text/markdown', bytes('first'))
  const second = addDocument(domain, 'notes.md', 'text/markdown', bytes('second'))

  expect([first.stored, second.stored]).toEqual([
    'context/docs/notes.md',
    'context/docs/notes-2.md',
  ])
  expect(readFileSync(statePath(domain, first.stored), 'utf8')).toBe('first')
})

test('uuid-named documents are migrated in place, once', () => {
  const domain = root()
  const legacy = 'context/documents/2b0d9d7e-1f2a-4a10-9f0c-1a2b3c4d5e6f.md'
  writeStateBuffer(domain, legacy, bytes('legacy body'))
  writeJson(domain, 'context/documents/index.json', [
    {
      id: '2b0d9d7e-1f2a-4a10-9f0c-1a2b3c4d5e6f',
      name: 'Meeting notes.md',
      type: 'text/markdown',
      size: 11,
      addedAt: new Date(0).toISOString(),
      stored: legacy,
    },
  ])

  migrateDocuments(domain)
  const [migrated] = listDocuments(domain)

  expect(migrated?.stored).toBe('context/docs/meeting-notes.md')
  expect(readFileSync(statePath(domain, migrated!.stored), 'utf8')).toBe('legacy body')
  expect(existsSync(statePath(domain, legacy))).toBe(false)

  // idempotent: a second boot leaves the already-migrated store alone
  migrateDocuments(domain)
  expect(listDocuments(domain)[0]?.stored).toBe('context/docs/meeting-notes.md')
})
