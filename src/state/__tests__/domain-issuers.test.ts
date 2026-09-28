import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { DomainIssuerCache } from '../domain-issuers'

const kernel = 'https://child.example/api'
const other = 'https://other.example/api'
const issues = 'https://issues.example'

let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'astrale-domain-issuers-'))
  path = join(directory, 'session', 'domain-issuers.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('domain issuer cache', () => {
  /** @evidence TEST-CLI-DOMAIN-ISSUER-CACHE-PARTITION */
  test('remembers remote and Kernel-hosted Domains per Kernel under private modes', async () => {
    const cache = new DomainIssuerCache(path)
    expect(await cache.get(kernel, 'issues.example', 1_000)).toBeUndefined()
    await cache.set(kernel, 'issues.example', issues, 1_000)
    await cache.set(kernel, 'local.example', null, 1_000)

    expect(await cache.get(kernel, 'issues.example', 2_000)).toBe(issues)
    expect(await cache.get(kernel, 'local.example', 2_000)).toBeNull()
    expect(await cache.get(other, 'issues.example', 2_000)).toBeUndefined()
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
  })

  /** @evidence TEST-CLI-DOMAIN-ISSUER-CACHE-BOUNDED */
  test('forgets entries after their age, on delete, and per Kernel', async () => {
    const cache = new DomainIssuerCache(path, 10_000)
    await cache.set(kernel, 'issues.example', issues, 1_000)
    await cache.set(kernel, 'shell.example', 'https://shell.example', 1_000)
    await cache.set(other, 'issues.example', issues, 1_000)

    expect(await cache.get(kernel, 'issues.example', 10_999)).toBe(issues)
    expect(await cache.get(kernel, 'issues.example', 11_000)).toBeUndefined()
    expect(await cache.get(kernel, 'issues.example', 999)).toBeUndefined()

    await cache.delete(kernel, 'issues.example')
    expect(await cache.get(kernel, 'issues.example', 2_000)).toBeUndefined()
    expect(await cache.get(kernel, 'shell.example', 2_000)).toBe('https://shell.example')

    await cache.deleteKernel(kernel)
    expect(await cache.get(kernel, 'shell.example', 2_000)).toBeUndefined()
    expect(await cache.get(other, 'issues.example', 2_000)).toBe(issues)
  })

  /** @evidence TEST-CLI-DOMAIN-ISSUER-CACHE-EVICTABLE */
  test.skipIf(process.getuid?.() === 0)('never trusts an entry it could not forget', async () => {
    const cache = new DomainIssuerCache(path)
    await cache.set(kernel, 'issues.example', issues, 1_000)
    await chmod(dirname(path), 0o500)
    try {
      expect(await cache.get(kernel, 'issues.example', 2_000)).toBeUndefined()
      await expect(cache.delete(kernel, 'issues.example')).rejects.toBeDefined()
    } finally {
      await chmod(dirname(path), 0o700)
    }
    expect(await cache.get(kernel, 'issues.example', 2_000)).toBe(issues)
  })

  test('removes the whole store when one entry cannot be rewritten away', async () => {
    const cache = new DomainIssuerCache(path, undefined, { timeoutMs: 50, pollIntervalMs: 10 })
    await cache.set(kernel, 'issues.example', issues, 1_000)
    await cache.set(kernel, 'shell.example', 'https://shell.example', 1_000)
    // A live lock held by another process: the locked rewrite cannot run.
    await writeFile(`${path}.lock`, '{}')
    try {
      await cache.delete(kernel, 'issues.example')
    } finally {
      await rm(`${path}.lock`, { force: true })
    }
    expect(await cache.get(kernel, 'issues.example', 2_000)).toBeUndefined()
    expect(await cache.get(kernel, 'shell.example', 2_000)).toBeUndefined()
  })

  test('treats unreadable, foreign, or malformed state as a miss and repairs it on write', async () => {
    const cache = new DomainIssuerCache(path)
    await mkdir(dirname(path), { recursive: true })
    for (const content of [
      'not json',
      JSON.stringify({ version: 99, entries: {} }),
      JSON.stringify({
        version: 1,
        entries: {
          [JSON.stringify([kernel, 'issues.example'])]: { issuer: 'not an issuer', observedAt: 1 },
        },
      }),
      JSON.stringify({
        version: 1,
        entries: {
          [JSON.stringify([kernel, 'issues.example'])]: { issuer: issues, observedAt: 1, extra: 1 },
        },
      }),
    ]) {
      await writeFile(path, content)
      expect(await cache.get(kernel, 'issues.example', 2)).toBeUndefined()
    }
    await cache.set(kernel, 'issues.example', issues, 2)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      entries: { [JSON.stringify([kernel, 'issues.example'])]: { issuer: issues, observedAt: 2 } },
    })
  })
})
