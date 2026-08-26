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

  assert.match(source, /focused product interface, not a landing page/)
  assert.match(source, /Before writing UI code, sketch a high-level wireframe/)
  assert.match(source, /Do not turn every element into a card/)
  assert.match(source, /Never show multiple loaders for one action/)
  assert.match(source, /Use optimistic list updates.*Roll back on failure/s)
  assert.match(source, /clicks outside it or presses Escape/)
  assert.match(source, /Make long labels and values part of layout testing/)
  assert.match(source, /perform a dedicated text-reduction pass/)
})
