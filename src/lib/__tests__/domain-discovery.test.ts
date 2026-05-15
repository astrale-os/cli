import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AstraleError } from '../../errors'
import { findDomainDirsUnder, resolveDomainDirs } from '../domain-discovery'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'astrale-domain-disco-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Create a domain dir (package.json + envs.ts) at `root/<rel>`. */
async function seedDomain(rel: string, name = '@astrale-os/seed-domain'): Promise<string> {
  const dir = rel ? join(root, rel) : root
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name }))
  await writeFile(join(dir, 'envs.ts'), 'export const domainEnvs = {}\n')
  return dir
}

async function mkEmpty(rel: string): Promise<string> {
  const dir = join(root, rel)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('findDomainDirsUnder', () => {
  test('finds a single domain at the root', async () => {
    await seedDomain('')
    expect(await findDomainDirsUnder(root)).toEqual([root])
  })

  test('finds multiple flat domains, sorted and absolute', async () => {
    const a = await seedDomain('domains/a')
    const b = await seedDomain('domains/b')
    const c = await seedDomain('domains/c')
    expect(await findDomainDirsUnder(root)).toEqual([a, b, c].sort())
  })

  test('stops descending once a domain root matches (no nested domains)', async () => {
    const outer = await seedDomain('outer')
    await seedDomain('outer/inner') // would-be nested domain
    expect(await findDomainDirsUnder(root)).toEqual([outer])
  })

  test('skips excluded directory names', async () => {
    await seedDomain('node_modules/x')
    await seedDomain('templates/y')
    await seedDomain('.git/z')
    await seedDomain('dist/d')
    expect(await findDomainDirsUnder(root)).toEqual([])
  })

  test('respects maxDepth', async () => {
    const deep = await seedDomain('a/b/c/d/e/dom') // dom is depth 6 from root
    expect(await findDomainDirsUnder(root)).toEqual([]) // default maxDepth 5
    expect(await findDomainDirsUnder(root, { maxDepth: 6 })).toEqual([deep])
  })

  test('a partial dir is not a domain but descent continues into it', async () => {
    const onlyPkg = await mkEmpty('onlypkg')
    await writeFile(join(onlyPkg, 'package.json'), '{}')
    const real = await seedDomain('onlypkg/real')
    expect(await findDomainDirsUnder(root)).toEqual([real])
  })

  test('non-existent root returns [] without throwing', async () => {
    expect(await findDomainDirsUnder(join(root, 'nope'))).toEqual([])
  })

  test('result is sorted and deduped', async () => {
    await seedDomain('domains/c')
    await seedDomain('domains/a')
    await seedDomain('domains/b')
    const out = await findDomainDirsUnder(root)
    expect(out).toEqual([...out].sort())
    expect(new Set(out).size).toBe(out.length)
    expect(out.length).toBe(3)
  })
})

describe('resolveDomainDirs', () => {
  test('returns the down-scan hits when run above domains', async () => {
    const a = await seedDomain('domains/a')
    const b = await seedDomain('domains/b')
    expect(await resolveDomainDirs(root)).toEqual([a, b].sort())
  })

  test('falls back to the walk-up single domain from a subfolder', async () => {
    const domain = await seedDomain('mydomain', '@astrale-os/fallback-domain')
    const sub = await mkEmpty('mydomain/src/deep')
    expect(await resolveDomainDirs(sub)).toEqual([domain])
  })

  test('throws NOT_IN_DOMAIN when nothing is found below or above', async () => {
    const empty = await mkEmpty('empty/here')
    try {
      await resolveDomainDirs(empty)
      throw new Error('expected resolveDomainDirs to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AstraleError)
      expect((e as AstraleError).code).toBe('NOT_IN_DOMAIN')
    }
  })
})
