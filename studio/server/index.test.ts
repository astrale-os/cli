/**
 * The server entry, run as `astrale studio` runs it:
 * - with nothing to open it exits, non-zero, instead of idling on a port it never bound —
 *   `astrale studio` stops waiting the moment this server exits;
 * - it answers only the Studio's own page and clients that are not browsers, on every route.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { forwardBridgeTool } from './agent/bridge/client'
import { disposeTestDomains, testDomain } from './test-domain'

const workspaces: string[] = []
const servers: Bun.Subprocess[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.kill()
    await server.exited
  }
  disposeTestDomains()
  while (workspaces.length) rmSync(workspaces.pop()!, { recursive: true, force: true })
})

test('the server refuses a workspace with no domain and exits non-zero', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'studio-empty-workspace-'))
  workspaces.push(workspace)
  // A port the server must never reach: it has to give up before binding.
  const port = 45_999

  const server = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'index.ts'),
      workspace,
      '--port',
      `${port}`,
      '--no-open',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const timer = setTimeout(() => server.kill(), 30_000)
  const [exitCode, stderr] = await Promise.all([
    server.exited,
    new Response(server.stderr).text(),
  ]).finally(() => clearTimeout(timer))

  expect(exitCode).toBe(1)
  expect(stderr).toContain('No Astrale domains found')
  expect(stderr).toContain(workspace)
  await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
})

/** The variables a developer's shell may hold that would change how the server runs. */
const LAUNCH = ['PORT', 'DOMAIN_STUDIO_HOST', 'DOMAIN_STUDIO_DEV', 'VITE_URL', 'DOMAIN_STUDIO_DIST']

/**
 * The server on a one-Domain workspace at a port the system picks, once indexed: the readiness
 * probe `astrale studio` waits on has answered.
 */
async function studio(env: Record<string, string>) {
  const domain = testDomain()
  const page = mkdtempSync(join(tmpdir(), 'studio-page-'))
  workspaces.push(page)
  writeFileSync(join(page, 'index.html'), 'the page')
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !LAUNCH.includes(name)),
  )
  const server = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'index.ts'), domain.root, '--port', '0', '--no-open'],
    {
      env: { ...inherited, DOMAIN_STUDIO_DIST: page, ...env },
      stdout: 'pipe',
      stderr: 'ignore',
    },
  )
  servers.push(server)

  let printed = ''
  let port: number | undefined
  const decoder = new TextDecoder()
  const reader = server.stdout.getReader()
  while (port === undefined) {
    const { done, value } = await reader.read()
    if (done) throw new Error(`the server exited before it listened:\n${printed}`)
    printed += decoder.decode(value, { stream: true })
    const listening = printed.match(/▸ http:\/\/localhost:(\d+)/)?.[1]
    if (listening) port = Number(listening)
  }
  // keep its output flowing: a full pipe would stall the server
  void (async () => {
    while (!(await reader.read()).done);
  })()

  const ready = `http://127.0.0.1:${port}/api/ready`
  while ((await fetch(ready)).status !== 204) await Bun.sleep(100)

  /** A request at this server's port, under the `Host` a client names it by. */
  const call = (host: string, path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: { host, ...(init.headers as Record<string, string>) },
    })
  const [{ id }] = await (await call(`127.0.0.1:${port}`, '/api/workspace')).json()
  return { port, call, visibility: `/api/domain/${encodeURIComponent(id)}/visibility` }
}

const hide = (headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ action: 'set', hidden: { 'class.Injected': true } }),
})

const refusedHost = (host: string) => ({
  error: `This Studio answers only its own page: the host ${host} is not this Studio's.`,
})

test("only the Studio's own page and clients that are not browsers drive the server, on every route", async () => {
  const { port, call, visibility } = await studio({})
  const studioHost = `127.0.0.1:${port}`
  const nothingHidden = { hidden: {}, showInheritedEdges: true }

  // a page at another name rebound to this address: same-origin with itself, not with the Studio
  const rebound = `attacker.example:${port}`
  const asRebound = { origin: `http://${rebound}`, 'sec-fetch-site': 'same-origin' }
  const written = await call(rebound, visibility, hide(asRebound))
  expect(written.status).toBe(403)
  expect(await written.json()).toEqual(refusedHost(rebound))
  for (const path of ['/api/workspace', '/api/events', '/', '/api/ready', visibility])
    expect((await call(rebound, path, { headers: asRebound })).status).toBe(403)
  expect((await call(rebound, '/api/agent/bridge/domains', hide())).status).toBe(403)

  // any other site: an `<img>` reads with no Origin, a form or fetch writes with one
  for (const site of ['cross-site', 'same-site'])
    expect(
      (await call(studioHost, '/api/workspace', { headers: { 'sec-fetch-site': site } })).status,
    ).toBe(403)
  for (const origin of [
    `https://${studioHost}`,
    'http://127.0.0.1:3000',
    'https://malicious.example',
  ])
    expect((await call(studioHost, visibility, hide({ origin }))).status).toBe(403)
  expect(await (await call(studioHost, visibility)).json()).toEqual(nothingHidden)

  // the agent's bridge, a client that is not a browser: the bridge itself judges its token
  const bridged = await forwardBridgeTool(
    `http://127.0.0.1:${port}/api/agent/bridge`,
    'no-such-run',
    'domains',
    {},
  )
  expect(bridged.content[0].text).toBe(
    'bridge error 401: {"error":"invalid or expired bridge token"}',
  )

  // the page, opened at a loopback name: its files, its events, its writes
  for (const host of [studioHost, `localhost:${port}`]) {
    const own = { origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }
    expect(await (await call(host, '/', { headers: { 'sec-fetch-site': 'none' } })).text()).toBe(
      'the page',
    )
    const events = await call(host, '/api/events', { headers: own })
    expect(events.headers.get('content-type')).toStartWith('text/event-stream')
    await events.body?.cancel()
    expect((await call(host, visibility, hide(own))).status).toBe(200)
  }
  expect((await (await call(studioHost, visibility)).json()).hidden).toEqual({
    'class.Injected': true,
  })
}, 60_000)

test("under --dev, the page comes through the Vite proxy, and only the Studio's page reaches it", async () => {
  const proxied: string[] = []
  const vite = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req) => {
      proxied.push(new URL(req.url).pathname)
      return new Response('the dev page')
    },
  })
  try {
    const devOrigin = `http://127.0.0.1:${vite.port}`
    const { port, call } = await studio({ DOMAIN_STUDIO_DEV: '1', VITE_URL: devOrigin })
    const studioHost = `localhost:${port}`

    const page = await call(studioHost, '/src/main.tsx', { headers: { 'sec-fetch-site': 'none' } })
    expect(await page.text()).toBe('the dev page')
    const fromVite = { origin: devOrigin, 'sec-fetch-site': 'same-site' }
    expect((await call(studioHost, '/api/workspace', { headers: fromVite })).status).toBe(200)
    expect((await call(`127.0.0.1:${vite.port}`, '/api/workspace')).status).toBe(200)

    // another loopback port is still another site, and a rebound page never reaches Vite
    const other = { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-site' }
    expect((await call(studioHost, '/api/workspace', { headers: other })).status).toBe(403)
    const rebound = `attacker.example:${port}`
    expect(await (await call(rebound, '/src/main.tsx')).json()).toEqual(refusedHost(rebound))
    expect(proxied).toEqual(['/src/main.tsx'])
  } finally {
    vite.stop(true)
  }
}, 60_000)
