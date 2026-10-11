import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addDocument, readDocument } from './documents'
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
