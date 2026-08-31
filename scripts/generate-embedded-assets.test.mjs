import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const generatedDirectory = join(root, 'src', 'generated')
const outputName = 'embedded-assets.ts'

test('the large embedded source survives formatting without stdout truncation or temporary files', () => {
  const before = temporaryFiles()
  const outcome = spawnSync('bun', ['scripts/generate-embedded-assets.ts', '--check'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(outcome.status, 0, outcome.stderr)
  assert.ok(readFileSync(join(generatedDirectory, outputName)).byteLength > 255_360)
  assert.deepEqual(temporaryFiles(), before)
})

function temporaryFiles() {
  return readdirSync(generatedDirectory)
    .filter((name) => name.startsWith(`${outputName}.`) && name.endsWith('.ts'))
    .sort()
}
