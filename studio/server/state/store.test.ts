import { afterEach, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { asJsonRecord, asString } from '../json'
import {
  ensureDir,
  listState,
  readJson,
  readState,
  removeState,
  stateExists,
  statePath,
  writeJson,
  writeState,
  writeStateBuffer,
} from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('readJson returns only values admitted by its explicit decoder', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-json-store-'))
  roots.push(root)
  const decodeName = (value: unknown): string | undefined => asString(asJsonRecord(value)?.name)

  writeState(root, 'value.json', '{not json')
  expect(readJson(root, 'value.json', decodeName, 'fallback')).toBe('fallback')

  writeJson(root, 'value.json', { name: 42, future: { revision: 2 } })
  expect(readJson(root, 'value.json', decodeName, 'fallback')).toBe('fallback')

  writeJson(root, 'value.json', { name: 'accepted', future: { revision: 2 } })
  expect(readJson(root, 'value.json', decodeName, 'fallback')).toBe('accepted')
})

const guarded: Record<string, (root: string, prefix: string) => unknown> = {
  ensureDir: (root, prefix) => ensureDir(root, `${prefix}/created-dir`),
  writeState: (root, prefix) => writeState(root, `${prefix}/created.txt`, 'nope'),
  writeStateBuffer: (root, prefix) =>
    writeStateBuffer(root, `${prefix}/created.bin`, Uint8Array.of(1)),
  statePath: (root, prefix) => statePath(root, `${prefix}/created.txt`),
  readState: (root, prefix) => readState(root, `${prefix}/marker.txt`),
  listState: (root, prefix) => listState(root, prefix),
  removeState: (root, prefix) => removeState(root, prefix),
  stateExists: (root, prefix) => stateExists(root, prefix),
}

for (const [name, run] of Object.entries(guarded))
  test(`${name} refuses a lexical traversal and an existing symlink escape`, () => {
    const container = mkdtempSync(join(tmpdir(), 'studio-store-escape-'))
    roots.push(container)
    const root = join(container, 'domain')
    const external = join(container, 'external')
    mkdirSync(join(root, '.domain-studio'), { recursive: true })
    mkdirSync(external)
    writeFileSync(join(external, 'marker.txt'), 'keep')
    symlinkSync(external, join(root, '.domain-studio', 'escape'), 'dir')

    expect(() => run(root, '../escape')).toThrow('state-allowlist violation')
    expect(existsSync(join(root, 'escape'))).toBe(false)
    expect(() => run(root, 'escape')).toThrow('state-allowlist violation')
    expect(readdirSync(external)).toEqual(['marker.txt'])
  })

test('rejects a .domain-studio symlink but permits the domain root itself to be symlinked', () => {
  const container = mkdtempSync(join(tmpdir(), 'studio-store-root-symlink-'))
  roots.push(container)
  const physicalDomain = join(container, 'physical-domain')
  const linkedDomain = join(container, 'linked-domain')
  const external = join(container, 'external')
  mkdirSync(physicalDomain)
  mkdirSync(external)
  symlinkSync(physicalDomain, linkedDomain, 'dir')

  writeState(linkedDomain, 'allowed.txt', 'inside')
  expect(readState(linkedDomain, 'allowed.txt')).toBe('inside')
  expect(existsSync(join(physicalDomain, '.domain-studio', 'allowed.txt'))).toBe(true)

  rmSync(join(physicalDomain, '.domain-studio'), { recursive: true })
  symlinkSync(external, join(physicalDomain, '.domain-studio'), 'dir')
  expect(() => writeState(linkedDomain, 'escaped.txt', 'nope')).toThrow('state-allowlist violation')
  expect(existsSync(join(external, 'escaped.txt'))).toBe(false)
})
