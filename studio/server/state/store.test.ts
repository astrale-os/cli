import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

const guardedOperations = [
  {
    name: 'ensureDir',
    run: (root: string, prefix: string) => ensureDir(root, `${prefix}/created-dir`),
  },
  {
    name: 'writeState',
    run: (root: string, prefix: string) => writeState(root, `${prefix}/created.txt`, 'nope'),
  },
  {
    name: 'writeStateBuffer',
    run: (root: string, prefix: string) =>
      writeStateBuffer(root, `${prefix}/created.bin`, new Uint8Array([1, 2, 3])),
  },
  {
    name: 'statePath',
    run: (root: string, prefix: string) => statePath(root, `${prefix}/created.txt`),
  },
  {
    name: 'readState',
    run: (root: string, prefix: string) => readState(root, `${prefix}/marker.txt`),
  },
  {
    name: 'listState',
    run: (root: string, prefix: string) => listState(root, prefix),
  },
  {
    name: 'removeState',
    run: (root: string, prefix: string) => removeState(root, prefix),
  },
  {
    name: 'stateExists',
    run: (root: string, prefix: string) => stateExists(root, prefix),
  },
] as const

for (const operation of guardedOperations) {
  test(`${operation.name} rejects lexical traversal outside .domain-studio`, () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-store-traversal-'))
    roots.push(root)

    expect(() => operation.run(root, '../escape')).toThrow('state-allowlist violation')
    expect(existsSync(join(root, 'escape'))).toBe(false)
  })

  test(`${operation.name} rejects an existing descendant symlink escape`, () => {
    const container = mkdtempSync(join(tmpdir(), 'studio-store-symlink-'))
    roots.push(container)
    const root = join(container, 'domain')
    const external = join(container, 'external')
    mkdirSync(join(root, '.domain-studio'), { recursive: true })
    mkdirSync(external)
    writeFileSync(join(external, 'marker.txt'), 'keep')
    symlinkSync(external, join(root, '.domain-studio', 'escape'), 'dir')

    expect(() => operation.run(root, 'escape')).toThrow('state-allowlist violation')
    expect(existsSync(join(external, 'marker.txt'))).toBe(true)
    expect(existsSync(join(external, 'created.txt'))).toBe(false)
    expect(existsSync(join(external, 'created.bin'))).toBe(false)
    expect(existsSync(join(external, 'created-dir'))).toBe(false)
  })
}

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
