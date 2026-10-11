import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporary: string[] = []
const modulePath = new URL('../instance/bookmarks.ts', import.meta.url).href
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-instance-concurrency-'))
  temporary.push(directory)
  return directory
}

async function command(home: string, body: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import * as registry from ${JSON.stringify(modulePath)}; ${body}`,
    ],
    {
      env: { ...process.env, ASTRALE_HOME: home },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  return { code, stderr }
}

const ok = { code: 0, stderr: '' }
const instancesOf = async (home: string) =>
  JSON.parse(await readFile(join(home, 'instances.json'), 'utf8'))
const writeRegistry = (home: string, active: string, instances: Record<string, object>) =>
  writeFile(join(home, 'instances.json'), JSON.stringify({ version: 1, active, instances }))

describe('bookmark registry write ownership', () => {
  test('never loses a bookmark another CLI process wrote, concurrently or after a memoized read', async () => {
    const home = await fixture()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        command(
          home,
          `await registry.upsertInstance('host-${index}', {url:'https://h${index}.test'});`,
        ),
      ),
    )
    expect(results).toEqual(Array(8).fill(ok))
    expect(
      await command(
        home,
        `
      await registry.readInstances();
      const child = Bun.spawn([process.execPath, '--eval', ${JSON.stringify(`import {upsertInstance} from ${JSON.stringify(modulePath)}; await upsertInstance('first', {url:'https://first.test'});`)}]);
      if(await child.exited !== 0) throw new Error('child failed');
      await registry.upsertInstance('second', {url:'https://second.test'});
    `,
      ),
    ).toEqual(ok)
    const store = await instancesOf(home)
    expect(Object.keys(store.instances).sort()).toEqual([
      'first',
      ...Array.from({ length: 8 }, (_, index) => `host-${index}`),
      'second',
    ])
    expect(store.instances[store.active]).toBeDefined()
  })

  test('refuses an unversioned or corrupt registry, keeping it until an explicit recovery', async () => {
    const home = await fixture()
    const path = join(home, 'instances.json')
    const upsert = "await registry.upsertInstance('manager', {url:'https://new.test'});"
    await writeFile(path, '{corrupt')
    expect((await command(home, upsert)).code).not.toBe(0)
    expect(await readFile(path, 'utf8')).toBe('{corrupt')

    const saved = JSON.stringify({ active: 'manager', instances: {} })
    await writeFile(path, saved)
    await mkdir(join(home, 'keys'))
    const privatePath = join(home, 'keys', 'manager.private.jwk')
    await writeFile(privatePath, 'retained private key bytes')
    for (const body of ['await registry.readInstances();', upsert]) {
      const result = await command(home, body)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Rename this file to preserve it')
      expect(await readFile(path, 'utf8')).toBe(saved)
    }
    await rename(path, `${path}.saved`)
    expect(await command(home, upsert)).toEqual(ok)
    expect(await instancesOf(home)).toMatchObject({
      version: 1,
      active: 'manager',
      instances: { manager: { url: 'https://new.test' } },
    })
    expect(await readFile(privatePath, 'utf8')).toBe('retained private key bytes')
  })
})

describe('managed bookmark Shell exchange on write', () => {
  const url = 'https://bryan.eu.astrale.ai/api'
  const bryan = { url, issuer: url, slug: 'bryan', name: 'bryan', kind: 'bookmark' }
  const beta = 'https://shell.beta.astrale.ai'

  test('instance use resets a managed bookmark to its installed Shell', async () => {
    const home = await fixture()
    await writeRegistry(home, 'bryan', {
      bryan: { ...bryan, domainIssuer: 'https://shell-dev.example' },
    })
    expect(
      await command(
        home,
        `await registry.upsertManagedBookmark({key:'bryan', slug:'bryan', url:${JSON.stringify(url)}});`,
      ),
    ).toEqual(ok)
    const entry = (await instancesOf(home)).instances.bryan
    expect(entry).toMatchObject({ url, slug: 'bryan', name: 'bryan' })
    expect(entry).not.toHaveProperty('domainIssuer')
  })

  /** @evidence TEST-CLI-INSTANCE-REGISTRY-ISSUERS-RETAINED */
  test('a bookmark write preserves explicit issuers on all bookmarks, and reads them back', async () => {
    const home = await fixture()
    const team = { url: 'https://team.eu.astrale.ai/api', slug: 'team', kind: 'bookmark' }
    await writeRegistry(home, 'bryan', {
      bryan: { ...bryan, domainIssuer: beta },
      team: { ...team, domainIssuer: beta },
    })

    expect(
      await command(
        home,
        `await registry.upsertInstance('bryan', {url:${JSON.stringify(url)}, defaultIdentity:'alice'});
         registry.resetInstancesMemo();
         const read = await registry.resolveInstance('bryan');
         if (read.domainIssuer !== '${beta}' || read.domainOrigin !== undefined) throw new Error(JSON.stringify(read));`,
      ),
    ).toEqual(ok)
    const { instances } = await instancesOf(home)
    expect(instances.bryan).toMatchObject({ defaultIdentity: 'alice', domainIssuer: beta })
    expect(instances.team.domainIssuer).toBe(beta)
  })
})
