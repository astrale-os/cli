import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addDocument,
  briefedDocuments,
  deleteDocument,
  listDocuments,
  readDocument,
  updateDocument,
} from './documents'
import { UnreadableState } from './state-file'
import { statePath } from './store'

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

test('an index not read whole is said by the read; no document is added, updated or deleted', () => {
  const domain = root()
  const kept = addDocument(domain, 'notes.md', 'text/markdown', bytes('first'))
  const index = statePath(domain, 'context/documents/index.json')
  const entries = JSON.parse(readFileSync(index, 'utf8'))
  writeFileSync(index, JSON.stringify([...entries, { id: 'from-a-newer-studio', name: 'x' }]))
  const before = readFileSync(index, 'utf8')

  expect(() => listDocuments(domain)).toThrow(UnreadableState)
  expect(() => listDocuments(domain)).toThrow('document 2 (from-a-newer-studio) has no type')
  expect(briefedDocuments(domain)).toMatchObject({ documents: [] })
  expect(briefedDocuments(domain).unreadable).toContain(index)
  expect(() => addDocument(domain, 'more.md', 'text/markdown', bytes('more'))).toThrow(
    UnreadableState,
  )
  expect(existsSync(statePath(domain, 'context/docs/more.md'))).toBe(false)
  expect(() => updateDocument(domain, kept.id, bytes('changed'))).toThrow(UnreadableState)
  expect(() => deleteDocument(domain, kept.id)).toThrow(UnreadableState)
  expect(readFileSync(index, 'utf8')).toBe(before)
  expect(readFileSync(statePath(domain, kept.stored), 'utf8')).toBe('first')
})

test('a key this Studio does not know stays on the document that holds it', () => {
  const domain = root()
  const doc = addDocument(domain, 'notes.md', 'text/markdown', bytes('first'))
  const index = statePath(domain, 'context/documents/index.json')
  const [entry] = JSON.parse(readFileSync(index, 'utf8'))
  writeFileSync(index, JSON.stringify([{ ...entry, pinned: true }]))

  updateDocument(domain, doc.id, bytes('second'))
  addDocument(domain, 'other.md', 'text/markdown', bytes('other'))
  const after = JSON.parse(readFileSync(index, 'utf8'))
  expect(after.find((one: { id: string }) => one.id === doc.id)).toMatchObject({
    pinned: true,
    size: 6,
  })
})
