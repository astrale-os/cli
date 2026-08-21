import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { resolveTarget } from './detect'
import {
  depsInstalled,
  isDomainDir,
  registerDomain,
  resolveDomainEntry,
  unregisterDomain,
} from './domain'

const roots: string[] = []
const domainIds: string[] = []

afterEach(() => {
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fixture(entry: 'implementation.ts' | 'domain.ts', parent = tmpdir()): string {
  const root = mkdtempSync(join(parent, 'studio-domain-layout-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(join(root, entry), 'export const domain = {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const schema = {}\n')
  return root
}

test('detects the current implementation.ts layout and requires its SDK dependency', () => {
  const root = fixture('implementation.ts')

  expect(isDomainDir(root)).toBe(true)
  expect(basename(resolveDomainEntry(root)!)).toBe('implementation.ts')
  expect(depsInstalled(root)).toBe(false)

  mkdirSync(join(root, 'node_modules', '@astrale-os', 'kernel-core'), { recursive: true })
  expect(depsInstalled(root)).toBe(false)
  mkdirSync(join(root, 'node_modules', '@astrale-os', 'sdk'), { recursive: true })
  expect(depsInstalled(root)).toBe(true)

  const handle = registerDomain(root)!
  domainIds.push(handle.id)
  expect(basename(handle.domainFile)).toBe('implementation.ts')
  expect(resolveTarget(root).map((domain) => domain.root)).toEqual([root])
})

test('preserves domain.ts and kernel-core as the legacy fallback', () => {
  const root = fixture('domain.ts')
  mkdirSync(join(root, 'node_modules', '@astrale-os', 'kernel-core'), { recursive: true })

  expect(isDomainDir(root)).toBe(true)
  expect(depsInstalled(root)).toBe(true)
  const handle = registerDomain(root)!
  domainIds.push(handle.id)
  expect(basename(handle.domainFile)).toBe('domain.ts')
})

test('prefers implementation.ts when both composition entries exist', () => {
  const root = fixture('domain.ts')
  writeFileSync(join(root, 'implementation.ts'), 'export const domain = {}\n')

  expect(basename(resolveDomainEntry(root)!)).toBe('implementation.ts')
})

test('recognizes only an SDK that resolves from the Domain through an autonomous hoist', () => {
  const isolatedWorkspace = mkdtempSync(join(tmpdir(), 'studio-domain-no-hoist-'))
  roots.push(isolatedWorkspace)
  mkdirSync(join(isolatedWorkspace, 'packages'))
  const isolatedRoot = fixture('implementation.ts', join(isolatedWorkspace, 'packages'))
  expect(depsInstalled(isolatedRoot)).toBe(false)

  const hoistedWorkspace = mkdtempSync(join(tmpdir(), 'studio-domain-hoist-'))
  roots.push(hoistedWorkspace)
  mkdirSync(join(hoistedWorkspace, 'packages'))
  mkdirSync(join(hoistedWorkspace, 'node_modules', '@astrale-os', 'sdk'), { recursive: true })
  writeFileSync(
    join(hoistedWorkspace, 'node_modules', '@astrale-os', 'sdk', 'package.json'),
    JSON.stringify({
      name: '@astrale-os/sdk',
      type: 'module',
      exports: { './schema': './schema.js' },
    }),
  )
  writeFileSync(
    join(hoistedWorkspace, 'node_modules', '@astrale-os', 'sdk', 'schema.js'),
    'export const schema = {}\n',
  )
  const hoistedRoot = fixture('implementation.ts', join(hoistedWorkspace, 'packages'))

  expect(depsInstalled(hoistedRoot)).toBe(true)
})
