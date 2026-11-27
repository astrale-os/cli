/**
 * Only the Studio's own page, and clients that are not browsers, drive the server: one guard
 * before every route — the API, the events stream, the page.
 */
import { afterEach, expect, test } from 'bun:test'

import { studioAudience } from './api/guard'
import { broadcast } from './api/sse'
import { studioFetch } from './serve'
import { disposeTestDomains, testDomain } from './test-domain'

afterEach(disposeTestDomains)

const PORT = 4319
const STUDIO = `127.0.0.1:${PORT}`
const REBOUND = `attacker.example:${PORT}`

function server(dev?: string) {
  return studioFetch({
    audience: () => studioAudience({ port: PORT, boundHost: '127.0.0.1', devOrigin: dev }),
    ready: () => true,
    domains: () => [],
    notify: () => {},
    serveStatic: () => new Response('the page'),
  })
}

/** A request as it reaches the server: its URL built from `Host`, as Bun builds it. */
function request(
  host: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
) {
  return new Request(`http://${host}${path}`, { ...init, headers: { host, ...init.headers } })
}

const write = (
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit & {
  headers: Record<string, string>
} => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

const place = { action: 'set', lens: 'structure', positions: { 'class.Injected': { x: 1, y: 2 } } }

test('a page rebound to this address is refused everywhere, though it calls itself same-origin', async () => {
  const handle = testDomain()
  const layout = `/api/domain/${encodeURIComponent(handle.id)}/layout`
  const fetch = server()
  const rebound = { 'sec-fetch-site': 'same-origin', origin: `http://${REBOUND}` }

  // a write route
  const written = await fetch(request(REBOUND, layout, write(place, rebound)))
  expect(written.status).toBe(403)
  expect(await written.json()).toEqual({
    error: `This Studio answers only its own page: the host ${REBOUND} is not this Studio's.`,
  })
  expect(await (await fetch(request(STUDIO, layout))).json()).toEqual({})

  // a read route, the events stream, the page itself
  for (const path of ['/api/workspace', '/api/events', '/', '/api/ready']) {
    const read = await fetch(
      request(REBOUND, path, { headers: { 'sec-fetch-site': 'same-origin' } }),
    )
    expect(read.status).toBe(403)
  }
  // the refused stream registered no listener
  expect(broadcast({ type: 'workspace', domains: [] })).toBe(0)
})

test('a request from another site is refused on every method, reads included', async () => {
  const fetch = server()
  // an `<img>` on any page: a cross-site GET with no Origin
  for (const site of ['cross-site', 'same-site'])
    expect(
      (await fetch(request(STUDIO, '/api/workspace', { headers: { 'sec-fetch-site': site } })))
        .status,
    ).toBe(403)
  // an Origin that is not exactly this Studio's: same host, other scheme or port, another name
  for (const origin of [
    'https://127.0.0.1:4319',
    'http://127.0.0.1:3000',
    'https://malicious.example',
    'null',
  ]) {
    const refused = await fetch(request(STUDIO, '/api/workspace', { headers: { origin } }))
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toBe(
      `This Studio answers only its own page: the origin ${origin} is not this Studio's.`,
    )
  }
})

test("the Studio's own page and clients that are not browsers are answered", async () => {
  const handle = testDomain()
  const layout = `/api/domain/${encodeURIComponent(handle.id)}/layout`
  const fetch = server()

  // the CLI, curl, the agent's bridge: neither Origin nor Sec-Fetch-Site
  expect((await fetch(request(STUDIO, '/api/workspace'))).status).toBe(200)
  expect((await fetch(request(STUDIO, layout, write(place)))).status).toBe(200)
  expect((await fetch(request(STUDIO, '/api/ready'))).status).toBe(204)

  // the page, under any loopback name it was opened at
  for (const host of [STUDIO, `localhost:${PORT}`, `[::1]:${PORT}`]) {
    const own = { 'sec-fetch-site': 'same-origin', origin: `http://${host}` }
    expect((await fetch(request(host, layout, write(place, own)))).status).toBe(200)
    const page = await fetch(request(host, '/', { headers: { 'sec-fetch-site': 'none' } }))
    expect(await page.text()).toBe('the page')
  }
  expect((await (await fetch(request(STUDIO, layout))).json()).lenses).toEqual({
    structure: { 'class.Injected': { x: 1, y: 2 } },
  })
})

test('under --dev, the Vite dev origin is this Studio too, and nothing else is', async () => {
  const dev = 'http://127.0.0.1:5173'
  const fetch = server(dev)
  const fromVite = { 'sec-fetch-site': 'same-site', origin: dev }
  expect((await fetch(request(STUDIO, '/api/workspace', { headers: fromVite }))).status).toBe(200)
  expect(
    (await fetch(request('127.0.0.1:5173', '/api/workspace', { headers: fromVite }))).status,
  ).toBe(200)
  // another loopback port is still another site
  const other = { 'sec-fetch-site': 'same-site', origin: 'http://127.0.0.1:3000' }
  expect((await fetch(request(STUDIO, '/api/workspace', { headers: other }))).status).toBe(403)
  // and without --dev, the Vite origin is no one
  expect((await server()(request(STUDIO, '/api/workspace', { headers: fromVite }))).status).toBe(
    403,
  )
})

test('a server bound to another address answers that address, not any name', () => {
  const audience = studioAudience({ port: PORT, boundHost: '192.168.1.20' })
  expect(audience.hosts.has(`192.168.1.20:${PORT}`)).toBe(true)
  expect(audience.origins.has(`http://192.168.1.20:${PORT}`)).toBe(true)
  // a wildcard bind admits no name of its own: only the loopback names
  expect([...studioAudience({ port: PORT, boundHost: '0.0.0.0' }).hosts]).toEqual([
    `localhost:${PORT}`,
    `127.0.0.1:${PORT}`,
    `[::1]:${PORT}`,
  ])
})
