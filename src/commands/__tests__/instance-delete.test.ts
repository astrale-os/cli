import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url))
const registryModule = fileURLToPath(new URL('../../lib/instance.ts', import.meta.url))
const adminModule = fileURLToPath(new URL('../../lib/admin-instance.ts', import.meta.url))
const commandModule = fileURLToPath(new URL('../instance/delete.ts', import.meta.url))
const temporary: string[] = []
const url = 'https://demo.eu.astrale.ai/api'
const otherUrl = 'https://other.example/kernel'
const cacheKey = (issuer: string) => JSON.stringify([issuer, 'domain', 'source', 'self'])

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function run(
  options: {
    identifier?: string
    active?: string
    bookmarkUrl?: string
    bookmarkIssuer?: string
    resultUrl?: string
    resultIssuer?: string | null
    keepBookmark?: boolean
    failure?: boolean
    repoint?: boolean
    state?: string
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-instance-delete-'))
  temporary.push(directory)
  const registryPath = join(directory, 'instances.json')
  const store = {
    active: options.active ?? 'other',
    instances: {
      demo: {
        url: options.bookmarkUrl ?? url,
        issuer: options.bookmarkIssuer ?? options.bookmarkUrl ?? url,
        slug: 'demo',
        name: 'demo',
        kind: 'bookmark',
      },
      other: { url: otherUrl, issuer: otherUrl, kind: 'bookmark' },
    },
  }
  await writeFile(registryPath, JSON.stringify(store))
  const script = `
    import { mock } from 'bun:test'
    import { readFile, writeFile, mkdir } from 'node:fs/promises'
    import { dirname } from 'node:path'
    import * as registry from ${JSON.stringify(registryModule)}
    import { EXCHANGE_CREDENTIALS_PATH } from ${JSON.stringify(fileURLToPath(new URL('../../state/paths.ts', import.meta.url)))}
    globalThis.fetch = async () => { throw new Error('Unexpected network access') }
    const cache = { version: 2, entries: ${JSON.stringify({ [cacheKey(url)]: { credential: 'test-only' }, [cacheKey(otherUrl)]: { credential: 'other-test-only' } })} }
    await mkdir(dirname(EXCHANGE_CREDENTIALS_PATH), { recursive: true })
    await writeFile(EXCHANGE_CREDENTIALS_PATH, JSON.stringify(cache))
    mock.module(${JSON.stringify(adminModule)}, () => ({
      deleteOwnedInstance: async (_opts, identifier) => {
        if (identifier !== ${JSON.stringify(options.identifier ?? '@instance-id')}) throw new Error('Wrong receiver')
        ${options.failure ? "throw new Error('Admin deletion failed')" : ''}
        ${
          options.repoint
            ? `
          await registry.readInstances()
          const writer = Bun.spawn([process.execPath, '-e', ${JSON.stringify(`import { upsertInstance } from ${JSON.stringify(registryModule)}; await upsertInstance('demo', { url: '${otherUrl}', issuer: '${otherUrl}' });`)}], { stdout: 'pipe', stderr: 'pipe' })
          if (await writer.exited !== 0) throw new Error(await new Response(writer.stderr).text())
        `
            : ''
        }
        return ${JSON.stringify({ id: '@instance-id', slug: 'demo', url: options.resultUrl ?? url, ...(options.resultIssuer === null ? {} : { issuer: options.resultIssuer ?? url }), state: options.state ?? 'deleted' })}
      },
    }))
    const { default: command } = await import(${JSON.stringify(commandModule)})
    await command.action(${JSON.stringify(options.identifier ?? '@instance-id')}, { json: true, keepBookmark: ${options.keepBookmark ?? false} })
  `
  const child = Bun.spawn([process.execPath, '-e', script], {
    cwd: cliRoot,
    env: {
      ...process.env,
      ASTRALE_HOME: directory,
      ASTRALE_DATA_DIR: join(directory, 'data'),
      ASTRALE_KEYS_DIR: join(directory, 'keys'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  // The cache path is owned by the child's isolated ASTRALE_HOME.
  const cachePath = join(directory, 'exchange', 'credentials.json')
  return {
    exitCode,
    stdout,
    stderr,
    store: JSON.parse(await readFile(registryPath, 'utf8')),
    cache: JSON.parse(await readFile(cachePath, 'utf8')),
  }
}

describe('instance delete bookmark cleanup', () => {
  test.each(['demo', '@instance-id'])(
    'removes the matching bookmark and cache after deleting %s',
    async (identifier) => {
      const result = await run({ identifier })
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).state).toBe('deleted')
      expect(Object.keys(result.store.instances)).toEqual(['other'])
      expect(result.store.active).toBe('other')
      expect(Object.keys(result.cache.entries)).toEqual([cacheKey(otherUrl)])
    },
  )

  test('updates selection only when the removed bookmark was active', async () => {
    const result = await run({ active: 'demo' })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.store.active).toBe('other')
    expect(result.store.instances.demo).toBeUndefined()
  })

  test.each([false, true])(
    'uses the retained issuer as the endpoint when deleted URL is empty (repointed=%s)',
    async (repointed) => {
      const result = await run({
        resultUrl: '',
        bookmarkUrl: repointed ? otherUrl : url,
        bookmarkIssuer: url,
      })
      expect(result.exitCode, result.stderr).toBe(0)
      expect(Object.keys(result.store.instances)).toEqual(repointed ? ['demo', 'other'] : ['other'])
      expect(Object.keys(result.cache.entries)).toEqual(
        repointed ? [cacheKey(url), cacheKey(otherUrl)] : [cacheKey(otherUrl)],
      )
    },
  )

  test.each(['url', 'issuer', 'repoint'])(
    'preserves a same-name bookmark with different %s evidence',
    async (kind) => {
      const result = await run({
        identifier: 'demo',
        active: 'demo',
        ...(kind === 'url'
          ? { bookmarkUrl: otherUrl }
          : kind === 'issuer'
            ? { bookmarkIssuer: otherUrl }
            : { repoint: true }),
      })
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.store.active).toBe('demo')
      expect(result.store.instances.demo).toBeDefined()
      if (kind !== 'issuer') expect(result.store.instances.demo.url).toBe(otherUrl)
      expect(Object.keys(result.cache.entries)).toEqual([cacheKey(url), cacheKey(otherUrl)])
    },
  )

  test.each(['other', 'demo'])(
    'keep-bookmark preserves the entry, active %s and credentials',
    async (active) => {
      const result = await run({ identifier: 'demo', active, keepBookmark: true })
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.store.active).toBe(active)
      expect(result.store.instances.demo).toBeDefined()
      expect(Object.keys(result.cache.entries)).toEqual([cacheKey(url), cacheKey(otherUrl)])
    },
  )

  test('does not clean up a refused deletion', async () => {
    const result = await run({ identifier: 'demo', failure: true })
    expect(result.exitCode).toBe(1)
    expect(Object.keys(result.store.instances)).toEqual(['demo', 'other'])
    expect(Object.keys(result.cache.entries)).toEqual([cacheKey(url), cacheKey(otherUrl)])
  })

  test('retains bookmarks without exact remote coordinates or terminal deletion', async () => {
    for (const options of [{ resultUrl: '', resultIssuer: null }, { state: 'deleting' }]) {
      const result = await run({ identifier: 'demo', ...options })
      expect(result.exitCode, result.stderr).toBe(0)
      expect(result.store.instances.demo).toBeDefined()
      expect(Object.keys(result.cache.entries)).toEqual([cacheKey(url), cacheKey(otherUrl)])
    }
  })
})
