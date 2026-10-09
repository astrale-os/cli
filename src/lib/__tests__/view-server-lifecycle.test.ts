import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const owner = fileURLToPath(new URL('../view/server.ts', import.meta.url))

async function run(body: string) {
  const home = await mkdtemp(join(tmpdir(), 'astrale-view-lifetime-'))
  const source = `
    import assert from 'node:assert/strict'
    import { once } from 'node:events'
    import { request } from 'node:http'
    import { startViewServer } from ${JSON.stringify(owner)}
    // Exercise real scheduled callbacks in an isolated process, with only the idle cadence sped up.
    const nativeInterval = globalThis.setInterval
    globalThis.setInterval = (callback, delay, ...args) => nativeInterval(callback, delay === 60_000 ? 20 : delay, ...args)
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const config = (id, idleMs = 600_000) => ({
      session: { id, nonce: id, pid: 0, port: 0, pageUrl: '', createdAt: '2026-10-06T00:00:00.000Z',
        view: { target: '/:fixture.example', route: { key: 'fixture.example:view.application',
          declaration: { target: { kind: 'domain' } }, href: 'https://view.example/', handshake: 'none',
          issuer: 'https://fixture.example', etag: 'sha256:' + 'a'.repeat(64), revision: 'sha256:' + 'b'.repeat(64) } } },
      kernel: {}, proxy: { kernelUrl: 'https://kernel.example', issuer: 'https://kernel.example', direct: true },
      externalOrigins: [], idleMs, releaseGraceMs: 30,
    })
    const close = server => new Promise(resolve => server.close(resolve))
    const url = (server, id, path) => 'http://127.0.0.1:' + server.address().port + '/s/' + id + path
    ${body}
    console.log(JSON.stringify({ alive: true }))
  `
  try {
    const child = Bun.spawn([process.execPath, '-e', source], {
      env: { ...process.env, ASTRALE_HOME: home },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    // A leaked daemon timer can exit(0): only the end marker proves this process survived.
    expect(stdout).toContain('"alive":true')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('closing one server removes only its own signal handlers', async () => {
  await run(`
    const marker = () => {}
    process.on('SIGTERM', marker)
    process.on('SIGINT', marker)
    const before = { term: process.listenerCount('SIGTERM'), interrupt: process.listenerCount('SIGINT') }
    const first = startViewServer(config('first'))
    const second = startViewServer(config('second'))
    await Promise.all([once(first, 'listening'), once(second, 'listening')])
    await close(first)
    assert.equal(process.listenerCount('SIGTERM'), before.term + 1)
    assert.equal(process.listenerCount('SIGINT'), before.interrupt + 1)
    assert(process.listeners('SIGTERM').includes(marker))
    assert.equal((await fetch(url(second, 'second', '/state'))).status, 200)
    await close(second)
    assert.equal(process.listenerCount('SIGTERM'), before.term)
    assert.equal(process.listenerCount('SIGINT'), before.interrupt)
  `)
})

test('explicit close stops the idle timer while an existing request drains, preserving another server', async () => {
  await run(`
    const first = startViewServer(config('draining', 0))
    const second = startViewServer(config('retained'))
    await Promise.all([once(first, 'listening'), once(second, 'listening')])
    const received = once(first, 'request')
    const input = request(url(first, 'draining', '/status'), { method: 'POST', headers: { 'content-length': '2' } })
    const response = new Promise(resolve => input.on('response', async message => {
      for await (const chunk of message) {}
      resolve(message.statusCode)
    }))
    input.write('{')
    await received
    const closed = once(first, 'close')
    first.close()
    await delay(100)
    assert.equal((await fetch(url(second, 'retained', '/state'))).status, 200)
    input.end('}')
    assert.equal(await response, 200)
    await closed
    await close(second)
  `)
})

test('explicit close cancels an already scheduled departure after release', async () => {
  await run(`
    const server = startViewServer(config('released'))
    await once(server, 'listening')
    const response = await fetch(url(server, 'released', '/release'), {
      method: 'POST', headers: { 'x-astrale-view-host': '1', 'content-type': 'application/json' }, body: '{}'
    })
    assert.equal(response.status, 200)
    await response.json()
    await close(server)
    await delay(100)
  `)
})

test('overlapping shutdown signals retire and exit the same daemon exactly once', async () => {
  await run(`
    const before = new Set(process.listeners('SIGTERM'))
    const exits = []
    const server = startViewServer(config('signal'), { connect: async () => { throw new Error('No credential expected') }, exit: code => exits.push(code) })
    await once(server, 'listening')
    const terminate = process.listeners('SIGTERM').find(handler => !before.has(handler))
    terminate()
    terminate()
    await delay(100)
    assert.deepEqual(exits, [0])
    assert.equal(server.listening, false)
    assert.equal(process.listeners('SIGTERM').includes(terminate), false)
  `)
})
