import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'astrale-frontend-design',
)

test('the shipped frontend skill preserves the focused Domain UI contract', () => {
  const source = readFileSync(join(root, 'SKILL.md'), 'utf8')

  assert.match(source, /focused product interface, never a landing\s+page/)
  assert.match(source, /Before writing UI code, sketch a high-level wireframe/)
  assert.match(source, /Refused by default: a card per element/)
  assert.match(source, /One indicator per action/)
  assert.match(
    source,
    /Optimistic updates only when the result is predictable\. On failure: roll back/,
  )
  assert.match(source, /Dropdowns close on outside click and Escape/)
  assert.match(source, /Long labels and values are layout cases/)
  assert.match(source, /a dedicated pass reads every visible string in context/)
})
