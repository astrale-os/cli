import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
