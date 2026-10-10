import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporary: string[] = []
const modulePath = new URL('../instance.ts', import.meta.url).href
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

describe('bookmark registry write ownership', () => {
  test('preserves concurrent bookmarks created by independent CLI processes', async () => {
    const home = await fixture()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        command(
          home,
          `await registry.upsertInstance('host-${index}', {url:'https://host-${index}.example.test/kernel/host'});`,
        ),
      ),
    )
    expect(results.every((result) => result.code === 0)).toBe(true)
    const store = JSON.parse(await readFile(join(home, 'instances.json'), 'utf8'))
    expect(Object.keys(store.instances).sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `host-${index}`),
    )
    expect(store.instances[store.active]).toBeDefined()
  })

  test('does not discard another process write after a memoized read', async () => {
    const home = await fixture()
    const result = await command(
      home,
      `
      await registry.readInstances();
      const child = Bun.spawn([process.execPath, '--eval', ${JSON.stringify(`import {upsertInstance} from ${JSON.stringify(modulePath)}; await upsertInstance('first', {url:'https://first.test'});`)}]);
      if(await child.exited !== 0) throw new Error('child failed');
      await registry.upsertInstance('second', {url:'https://second.test'});
    `,
    )
    expect(result).toEqual({ code: 0, stderr: '' })
    const store = JSON.parse(await readFile(join(home, 'instances.json'), 'utf8'))
    expect(Object.keys(store.instances).sort()).toEqual(['first', 'second'])
  })

  test('refuses unversioned reads and writes, then recreates bookmarks only after explicit recovery', async () => {
    const home = await fixture()
    const path = join(home, 'instances.json')
    const saved = JSON.stringify({ active: 'manager', instances: {} })
    await writeFile(path, saved)
    await mkdir(join(home, 'keys'))
    const privatePath = join(home, 'keys', 'manager.private.jwk')
    await writeFile(privatePath, 'retained private key bytes')
    for (const body of [
      'await registry.readInstances();',
      "await registry.upsertInstance('manager', {url:'https://new.test'});",
    ]) {
      const result = await command(home, body)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Rename this file to preserve it')
      expect(await readFile(path, 'utf8')).toBe(saved)
    }
    await rename(path, `${path}.saved`)
    expect(
      await command(
        home,
        "await registry.upsertInstance('manager', {url:'https://new.test'}); registry.resetInstancesMemo(); const store = await registry.readInstances(); if (store.active !== 'manager' || store.instances.manager?.url !== 'https://new.test') throw new Error(JSON.stringify(store));",
      ),
    ).toEqual({ code: 0, stderr: '' })
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1)
    expect(await readFile(`${path}.saved`, 'utf8')).toBe(saved)
    expect(await readFile(privatePath, 'utf8')).toBe('retained private key bytes')
  })

  test('retains corrupt evidence instead of replacing it with a new registry', async () => {
    const home = await fixture()
    const path = join(home, 'instances.json')
    await writeFile(path, '{corrupt')
    const result = await command(
      home,
      `await registry.upsertInstance('new-host', {url:'https://new.test'});`,
    )
    expect(result.code).not.toBe(0)
    expect(await readFile(path, 'utf8')).toBe('{corrupt')
  })
})

describe('managed bookmark Shell exchange on write', () => {
  const url = 'https://bryan.eu.beta.astrale.ai/api'

  async function stored(home: string) {
    return JSON.parse(await readFile(join(home, 'instances.json'), 'utf8')).instances.bryan
  }

  test.each([
    'https://shell.beta.astrale.ai',
    'https://shell.astrale.ai',
    'https://shell-dev.example',
  ])(
    'instance use resets a managed bookmark with issuer %s to its installed Shell',
    async (domainIssuer) => {
      const home = await fixture()
      await writeFile(
        join(home, 'instances.json'),
        JSON.stringify({
          version: 1,
          active: 'bryan',
          instances: {
            bryan: {
              url,
              issuer: url,
              domainIssuer,
              slug: 'bryan',
              name: 'bryan',
              kind: 'bookmark',
            },
          },
        }),
      )
      const result = await command(
        home,
        `await registry.upsertManagedBookmark({key:'bryan', slug:'bryan', url:${JSON.stringify(url)}});`,
      )
      expect(result).toEqual({ code: 0, stderr: '' })
      const entry = await stored(home)
      expect(entry).toMatchObject({ url, slug: 'bryan', name: 'bryan' })
      expect(entry).not.toHaveProperty('domainIssuer')
    },
  )

  /** @evidence TEST-CLI-INSTANCE-REGISTRY-ISSUERS-RETAINED */
  test('a V1 bookmark write preserves explicit issuers on all bookmarks', async () => {
    const home = await fixture()
    const path = join(home, 'instances.json')
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        active: 'bryan',
        instances: {
          bryan: {
            url,
            issuer: url,
            domainIssuer: 'https://shell.beta.astrale.ai',
            slug: 'bryan',
            name: 'bryan',
            kind: 'bookmark',
          },
          team: {
            url: 'https://team.eu.beta.astrale.ai/api',
            domainIssuer: 'https://shell.beta.astrale.ai',
            slug: 'team',
            name: 'team',
            kind: 'bookmark',
          },
        },
      }),
    )

    // A locked write retains both bookmarks' explicit issuers.
    const touched = await command(
      home,
      `await registry.upsertInstance('bryan', {url:${JSON.stringify(url)}, defaultIdentity:'alice'});`,
    )
    expect(touched).toEqual({ code: 0, stderr: '' })
    const rewritten = JSON.parse(await readFile(path, 'utf8'))
    expect(rewritten.version).toBe(1)
    expect(rewritten.instances.bryan).toMatchObject({ slug: 'bryan', defaultIdentity: 'alice' })
    expect(rewritten.instances.bryan.domainIssuer).toBe('https://shell.beta.astrale.ai')
    expect(rewritten.instances.team.domainIssuer).toBe('https://shell.beta.astrale.ai')

    // In the labelled registry an explicit issuer is stored and read back, whatever its value.
    const explicit = await command(
      home,
      `await registry.upsertInstance('bryan', {url:${JSON.stringify(url)}, domainIssuer:'https://shell.beta.astrale.ai'});
       registry.resetInstancesMemo();
       const read = await registry.resolveInstance('bryan');
       if (read.domainIssuer !== 'https://shell.beta.astrale.ai' || read.domainOrigin !== undefined) throw new Error(JSON.stringify(read));`,
    )
    expect(explicit).toEqual({ code: 0, stderr: '' })
    expect(await stored(home)).toMatchObject({ domainIssuer: 'https://shell.beta.astrale.ai' })
  })
})
