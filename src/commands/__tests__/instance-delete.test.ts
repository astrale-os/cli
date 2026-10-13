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
    root?: 'matching' | 'shared' | 'other-issuer' | 'idp' | 'replaced' | 'broken-key'
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
      await upsertIdpIdentity('owner', { subject: 'human', idp: 'workos', issuer: 'https://idp.example' })
      const issuer = root === 'other-issuer' ? ${JSON.stringify(otherUrl)} : ${JSON.stringify(url)}
      if (root === 'idp') await upsertIdpIdentity('demo-root', { subject: 'root-subject', idp: 'workos', issuer, use: false })
      else await createIdentity('demo-root', { subject: 'root-subject', issuer })
      await setDefault('demo-root')
      if (root === 'shared') await importIdentity(await exportIdentity('demo-root'), { name: 'root-alias' })
    }
    const cache = { version: 2, entries: ${JSON.stringify({ [cacheKey(url)]: { credential: 'test-only' }, [cacheKey(otherUrl)]: { credential: 'other-test-only' } })} }
    await mkdir(dirname(EXCHANGE_CREDENTIALS_PATH), { recursive: true })
    await writeFile(EXCHANGE_CREDENTIALS_PATH, JSON.stringify(cache))
    mock.module(${JSON.stringify(adminModule)}, () => ({
      deleteOwnedInstance: async (_opts, identifier) => {
        if (identifier !== ${JSON.stringify(options.identifier ?? '@instance-id')}) throw new Error('Wrong receiver')
        ${options.failure ? "throw new Error('Admin deletion failed')" : ''}
        ${options.root === 'replaced' ? `await createIdentity('replacement', { subject: 'replacement-subject', issuer: ${JSON.stringify(url)} }); await importIdentity(await exportIdentity('replacement'), { name: 'demo-root', replace: true });` : ''}
        ${options.root === 'broken-key' ? "const { privatePath } = keypairPaths('root-subject'); await unlink(privatePath); await mkdir(privatePath);" : ''}
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
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: 'deleted',
      localRootIdentity: { status: 'absent' },
    })
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

test.each([
  { root: 'matching', identifier: 'demo', status: 'removed', keys: 0 },
  { root: 'matching', keepBookmark: true, status: 'removed', keys: 0 },
  { root: 'shared', status: 'removed', keys: 2 },
  { root: 'other-issuer', status: 'retained', keys: 2 },
  { root: 'idp', status: 'retained', keys: 0 },
  { root: 'replaced', status: 'retained', keys: 2 },
  { root: 'matching', failure: true, status: undefined, keys: 2 },
  { root: 'matching', state: 'deleting', status: undefined, keys: 2 },
  { root: 'broken-key', status: 'error', keys: 2 },
] as const)('instance delete root cleanup: %j', async ({ status, keys, ...options }) => {
  const result = await run(options)
  expect(result.exitCode, result.stderr).toBe('failure' in options ? 1 : 0)
  const output = result.exitCode === 0 ? JSON.parse(result.stdout) : undefined
  expect(output?.localRootIdentity?.status).toBe(status)
  const removed = status === 'removed' || status === 'error'
  expect(Boolean(result.identities.identities['demo-root'])).toBe(!removed)
  expect(result.identities.default).toBe(removed ? 'owner' : 'demo-root')
  expect(result.keys).toHaveLength(keys)
  if (status) expect(output.state).toBe('deleted')
  if ('keepBookmark' in options) expect(result.store.instances.demo).toBeDefined()
  if (options.root === 'shared') {
    expect(output.localRootIdentity.keyRetained).toBe(true)
    expect(result.identities.identities['root-alias'].subject).toBe('root-subject')
  }
  if (status === 'retained' || status === 'error')
    expect(result.stderr).toContain('Root identity demo-root:')
})
