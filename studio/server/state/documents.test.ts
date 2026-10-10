import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
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

test('a failed index commit preserves the old document and can be retried', () => {
  const domain = root()
  const legacy = 'context/documents/old.md'
  writeStateBuffer(domain, legacy, bytes('keep this document'))
  const metadata = {
    id: 'old',
    name: 'Notes.md',
    type: 'text/markdown',
    size: 18,
    addedAt: new Date(0).toISOString(),
    stored: legacy,
  }
  writeJson(domain, 'context/documents/index.json', [metadata])
  const index = statePath(domain, 'context/documents/index.json')
  const rename = fs.renameSync
  const failure = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (to === index) throw new Error('index commit interrupted')
    rename(from, to)
  })
  try {
    expect(() => migrateDocuments(domain)).toThrow('index commit interrupted')
    expect(listDocuments(domain)).toEqual([metadata])
    expect(readFileSync(readDocument(domain, 'old')!.abs, 'utf8')).toBe('keep this document')
  } finally {
    failure.mockRestore()
  }
  migrateDocuments(domain)
  const migrated = readDocument(domain, 'old')!
  expect(migrated.meta.stored.startsWith('context/docs/')).toBe(true)
  expect(readFileSync(migrated.abs, 'utf8')).toBe('keep this document')
  expect(existsSync(statePath(domain, legacy))).toBe(false)
  migrateDocuments(domain)
  expect(listDocuments(domain)).toEqual([migrated.meta])
})

test('an interrupted old-file cleanup leaves the committed document readable', () => {
  const domain = root()
  const legacy = 'context/documents/old.md'
  writeStateBuffer(domain, legacy, bytes('original'))
  writeJson(domain, 'context/documents/index.json', [
    {
      id: 'old',
      name: 'Notes.md',
      type: 'text/markdown',
      size: 8,
      addedAt: new Date(0).toISOString(),
      stored: legacy,
    },
  ])
  const remove = fs.rmSync
  const failure = spyOn(fs, 'rmSync').mockImplementation((path, options) => {
    if (path === statePath(domain, legacy)) throw new Error('cleanup interrupted')
    remove(path, options)
  })
  try {
    expect(() => migrateDocuments(domain)).toThrow('cleanup interrupted')
    expect(readFileSync(readDocument(domain, 'old')!.abs, 'utf8')).toBe('original')
    expect(listDocuments(domain)[0]?.stored).toBe('context/docs/notes.md')
  } finally {
    failure.mockRestore()
  }
  migrateDocuments(domain)
  expect(readFileSync(readDocument(domain, 'old')!.abs, 'utf8')).toBe('original')
})
