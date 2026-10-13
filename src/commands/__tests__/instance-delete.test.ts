import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url))
const registryModule = fileURLToPath(new URL('../../lib/instance/bookmarks.ts', import.meta.url))
const adminModule = fileURLToPath(new URL('../../lib/admin/instances.ts', import.meta.url))
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
    root?: { issuer?: string | null; source?: 'key' | 'idp'; selected?: boolean; alias?: boolean }
    replaceRoot?: boolean
    cleanupFailure?: boolean
    noOtherIdentity?: boolean
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-instance-delete-'))
  temporary.push(directory)
  const registryPath = join(directory, 'instances.json')
  const store = {
    version: 1,
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
    import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
    import { dirname } from 'node:path'
    import * as registry from ${JSON.stringify(registryModule)}
    import { createIdentity, exportIdentity, importIdentity, setDefault, upsertIdpIdentity } from ${JSON.stringify(fileURLToPath(new URL('../../identity/index.ts', import.meta.url)))}
    import { keypairPaths } from ${JSON.stringify(fileURLToPath(new URL('../../keys/index.ts', import.meta.url)))}
    import { EXCHANGE_CREDENTIALS_PATH } from ${JSON.stringify(fileURLToPath(new URL('../../state/paths.ts', import.meta.url)))}
    globalThis.fetch = async () => { throw new Error('Unexpected network access') }
    const root = ${JSON.stringify(options.root ?? null)}
    if (root) {
      if (!${options.noOtherIdentity ?? false}) await upsertIdpIdentity('owner', { subject: 'human', idp: 'workos', issuer: 'https://idp.example' })
      const issuer = root.issuer === null ? undefined : (root.issuer ?? ${JSON.stringify(url)})
      if (root.source === 'idp') await upsertIdpIdentity('demo-root', { subject: 'root-subject', idp: 'workos', issuer, use: false })
      else await createIdentity('demo-root', { subject: 'root-subject', issuer })
      if (root.selected) await setDefault('demo-root')
      if (root.alias) await importIdentity(await exportIdentity('demo-root'), { name: 'root-alias' })
    }
    const cache = { version: 2, entries: ${JSON.stringify({ [cacheKey(url)]: { credential: 'test-only' }, [cacheKey(otherUrl)]: { credential: 'other-test-only' } })} }
    await mkdir(dirname(EXCHANGE_CREDENTIALS_PATH), { recursive: true })
    await writeFile(EXCHANGE_CREDENTIALS_PATH, JSON.stringify(cache))
    mock.module(${JSON.stringify(adminModule)}, () => ({
      deleteOwnedInstance: async (_opts, identifier) => {
        if (identifier !== ${JSON.stringify(options.identifier ?? '@instance-id')}) throw new Error('Wrong receiver')
        ${options.failure ? "throw new Error('Admin deletion failed')" : ''}
        ${options.replaceRoot ? `await createIdentity('replacement', { subject: 'replacement-subject', issuer: ${JSON.stringify(url)} }); await importIdentity(await exportIdentity('replacement'), { name: 'demo-root', replace: true });` : ''}
        ${options.cleanupFailure ? "const { privatePath } = keypairPaths('root-subject'); await unlink(privatePath); await mkdir(privatePath);" : ''}
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
    identities: await readFile(join(directory, 'identities.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null),
    keys: await readdir(join(directory, 'keys')).catch(() => []),
  }
}

describe('instance delete bookmark cleanup', () => {
  test.each([
    { identifier: 'demo' },
    { identifier: '@instance-id', active: 'demo' },
    { resultUrl: '' },
  ])('removes the matching bookmark and credentials: %j', async (options) => {
    const result = await run(options)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).state).toBe('deleted')
    expect(Object.keys(result.store.instances)).toEqual(['other'])
    expect(result.store.active).toBe('other')
    expect(Object.keys(result.cache.entries)).toEqual([cacheKey(otherUrl)])
  })

  test.each([
    { bookmarkIssuer: otherUrl },
    { repoint: true },
    { keepBookmark: true },
    { failure: true },
    { resultUrl: '', resultIssuer: null },
    { state: 'deleting' },
  ])('preserves bookmark, selection and credentials: %j', async (options) => {
    const result = await run({ identifier: 'demo', active: 'demo', ...options })
    expect(result.exitCode, result.stderr).toBe('failure' in options ? 1 : 0)
    expect(Object.keys(result.store.instances)).toEqual(['demo', 'other'])
    expect(result.store.active).toBe('demo')
    expect(Object.keys(result.cache.entries)).toEqual([cacheKey(url), cacheKey(otherUrl)])
  })
})

describe('instance delete root identity cleanup', () => {
  test.each([
    { identifier: 'demo' },
    { identifier: '@instance-id' },
    { keepBookmark: true },
    { bookmarkIssuer: otherUrl },
    { root: { selected: true } },
    { root: { selected: true }, noOtherIdentity: true },
  ])('removes the matching root identity and both key files: %j', async (options) => {
    const result = await run({ root: {}, ...options })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: 'deleted',
      localRootIdentity: { name: 'demo-root', status: 'removed', keyRetained: false },
    })
    expect(result.identities.identities['demo-root']).toBeUndefined()
    expect(result.identities.default).toBe('noOtherIdentity' in options ? '' : 'owner')
    expect(result.keys).toEqual([])
    expect(result.cache.entries).toEqual({})
  })

  test('keeps a key shared by another identity', async () => {
    const result = await run({ root: { alias: true } })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).localRootIdentity).toMatchObject({
      status: 'removed',
      keyRetained: true,
    })
    expect(result.identities.identities['demo-root']).toBeUndefined()
    expect(result.identities.identities['root-alias'].subject).toBe('root-subject')
    expect(result.keys.sort()).toEqual(['root-subject.private.jwk', 'root-subject.public.jwk'])
  })

  test.each([
    { root: { issuer: otherUrl } },
    { root: { issuer: null } },
    { root: { source: 'idp' as const } },
    { resultIssuer: null },
    { replaceRoot: true },
  ])('reports and preserves an unrelated or replaced root identity: %j', async (options) => {
    const result = await run({ root: {}, ...options })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).localRootIdentity).toMatchObject({
      name: 'demo-root',
      status: 'retained',
    })
    expect(result.stderr).toContain('Root identity demo-root:')
    expect(result.identities.identities['demo-root']).toBeDefined()
    if (result.identities.identities['demo-root'].source !== 'idp')
      expect(result.keys).toHaveLength(2)
    expect(Object.keys(result.cache.entries)).toEqual([cacheKey(otherUrl)])
  })

  test.each([{ failure: true }, { state: 'deleting' }])(
    'keeps the identity and keys until deletion succeeds: %j',
    async (options) => {
      const result = await run({ root: {}, ...options })
      expect(result.exitCode).toBe('failure' in options ? 1 : 0)
      expect(result.identities.identities['demo-root']).toBeDefined()
      expect(result.keys).toHaveLength(2)
      expect(Object.keys(result.cache.entries)).toEqual([cacheKey(url), cacheKey(otherUrl)])
    },
  )

  test('reports an absent root identity', async () => {
    const result = await run()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).localRootIdentity).toEqual({
      name: 'demo-root',
      status: 'absent',
    })
  })

  test('reports local cleanup failure without obscuring the completed remote deletion', async () => {
    const result = await run({ root: {}, cleanupFailure: true })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: 'deleted',
      localRootIdentity: { status: 'error' },
    })
    expect(result.stderr).toContain('Local root cleanup failed')
    expect(result.store.instances.demo).toBeUndefined()
    expect(result.identities.identities['demo-root']).toBeUndefined()
  })
})
