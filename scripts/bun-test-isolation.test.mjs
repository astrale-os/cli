import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

// Without --isolate, Bun shares one module registry across test files. When a
// file mocks a barrel that is already loaded, Bun rewrites the re-exported
// binding in the source module too, so the mock reaches every later file that
// imports that source module directly. The outcome then depends on file
// discovery order, which differs between machines (CI vs local).

const scripts = (path) => JSON.parse(readFileSync(path, 'utf8')).scripts
const bunTestRuns = (script) => script.match(/\bbun test\b[^&]*/gu) ?? []

describe('bun test isolation', () => {
  it('runs every bun test suite with one module registry per file', () => {
    const runs = [
      ...Object.values(scripts('package.json')),
      ...Object.values(scripts('studio/package.json')),
    ].flatMap(bunTestRuns)
    assert.ok(runs.length >= 3)
    for (const run of runs) assert.match(run, /\s--isolate\b/u, run)
  })

  it('keeps a barrel mock in one file out of the source module seen by the next', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrale-bun-isolation-'))
    try {
      writeFileSync(join(dir, 'source.ts'), "export const value = () => 'real'\n")
      writeFileSync(join(dir, 'barrel.ts'), "export { value } from './source'\n")
      writeFileSync(
        join(dir, 'a-mocks.test.ts'),
        [
          "import { mock, test } from 'bun:test'",
          "await import('./barrel')",
          "mock.module('./barrel', () => ({ value: () => 'mocked' }))",
          "test('mocks the loaded barrel', () => {})",
        ].join('\n'),
      )
      writeFileSync(
        join(dir, 'b-reads.test.ts'),
        [
          "import { expect, test } from 'bun:test'",
          "import { value } from './source'",
          "test('reads the real source module', () => expect(value()).toBe('real'))",
        ].join('\n'),
      )
      const result = spawnSync(
        'bun',
        ['test', '--isolate', './a-mocks.test.ts', './b-reads.test.ts'],
        { cwd: dir, encoding: 'utf8' },
      )
      const output = `${result.stdout}\n${result.stderr}`
      assert.equal(result.status, 0, output)
      assert.match(output, /\b2 pass\b/u, output)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
