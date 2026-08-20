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

function fixture(entry: 'implementation.ts' | 'domain.ts'): string {
  const root = mkdtempSync(join(tmpdir(), 'studio-domain-layout-'))
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
