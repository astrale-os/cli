import { expect, test } from 'bun:test'

import { refusal, studioAudience } from './guard'

const PORT = 4319
const STUDIO = `127.0.0.1:${PORT}`
const audience = studioAudience({ port: PORT, boundHost: '127.0.0.1' })

/** A request as it reaches the server: its URL built from `Host`, as Bun builds it. */
function request(host: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`http://${host}/api/workspace`, { method, headers: { host, ...headers } })
}

const status = (req: Request, to = audience) => refusal(req, to)?.status ?? 'answered'

test('a page rebound to this address names its own host, and is refused though it calls itself same-origin', async () => {
  const rebound = `attacker.example:${PORT}`
  const refused = refusal(
    request(rebound, { origin: `http://${rebound}`, 'sec-fetch-site': 'same-origin' }, 'POST'),
    audience,
  )
  expect(refused?.status).toBe(403)
  expect(refused?.headers.get('cache-control')).toBe('no-store')
  expect(await refused?.json()).toEqual({
    error: `This Studio answers only its own page: the host ${rebound} is not this Studio's.`,
  })
  // a read too, and a client that sends no browser header at all
  expect(status(request(rebound))).toBe(403)
  // the right name at another port is another server
  expect(status(request('127.0.0.1:4320'))).toBe(403)
})

test('a request from another site is refused on every method, reads included', async () => {
  for (const method of ['GET', 'HEAD', 'POST', 'DELETE'])
    for (const site of ['cross-site', 'same-site'])
      expect(status(request(STUDIO, { 'sec-fetch-site': site }, method))).toBe(403)

  // an Origin that is not exactly this Studio's: same host, other scheme or port, another name
  for (const origin of [
    'https://127.0.0.1:4319',
    'http://127.0.0.1:3000',
    'http://127.0.0.1',
    'https://malicious.example',
    'null',
  ]) {
    const refused = refusal(request(STUDIO, { origin }), audience)
    expect(refused?.status).toBe(403)
    expect((await refused?.json()).error).toBe(
      `This Studio answers only its own page: the origin ${origin} is not this Studio's.`,
    )
  }
})

test("the Studio's own page and clients that are not browsers are answered", () => {
  // the CLI, curl, the agent's bridge: neither Origin nor Sec-Fetch-Site
  expect(status(request(STUDIO), audience)).toBe('answered')
  expect(status(request(STUDIO, {}, 'POST'))).toBe('answered')

  // the page, under any loopback name it was opened at, and the address typed by its reader
  for (const host of [STUDIO, `localhost:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`]) {
    const own = { origin: `http://${host.toLowerCase()}`, 'sec-fetch-site': 'same-origin' }
    expect(status(request(host, own, 'POST'))).toBe('answered')
    expect(status(request(host, { 'sec-fetch-site': 'none' }))).toBe('answered')
  }
})

test('under --dev, the Vite dev origin is this Studio too, and nothing else is', () => {
  const dev = 'http://127.0.0.1:5273'
  const devAudience = studioAudience({ port: PORT, boundHost: '127.0.0.1', devOrigin: dev })
  const fromVite = { origin: dev, 'sec-fetch-site': 'same-site' }
  expect(status(request(STUDIO, fromVite, 'POST'), devAudience)).toBe('answered')
  expect(status(request('127.0.0.1:5273', fromVite), devAudience)).toBe('answered')
  // another loopback port is still another site
  const other = { origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-site' }
  expect(status(request(STUDIO, other), devAudience)).toBe(403)
  // a same-site request that names no origin is no one's
  expect(status(request(STUDIO, { 'sec-fetch-site': 'same-site' }), devAudience)).toBe(403)
  // and without --dev, the Vite origin is no one
  expect(status(request(STUDIO, fromVite))).toBe(403)
  expect(status(request('127.0.0.1:5273'))).toBe(403)
})

test('a server bound to another address answers that address, not any name', () => {
  const lan = studioAudience({ port: PORT, boundHost: '192.168.1.20' })
  expect(status(request(`192.168.1.20:${PORT}`), lan)).toBe('answered')
  expect(
    status(
      request(STUDIO, { origin: `http://192.168.1.20:${PORT}`, 'sec-fetch-site': 'same-origin' }),
      lan,
    ),
  ).toBe('answered')
  // an IPv6 address is named in brackets, as a Host header writes it
  expect(studioAudience({ port: PORT, boundHost: 'FE80::1' }).hosts.has(`[fe80::1]:${PORT}`)).toBe(
    true,
  )
  // a wildcard bind admits no name of its own: only the loopback names
  for (const wildcard of ['0.0.0.0', '::'])
    expect([...studioAudience({ port: PORT, boundHost: wildcard }).hosts]).toEqual([
      `localhost:${PORT}`,
      `127.0.0.1:${PORT}`,
      `[::1]:${PORT}`,
    ])
  // at port 80, a browser leaves the port out of both headers
  const http = studioAudience({ port: 80 })
  expect(status(request('localhost', { origin: 'http://localhost' }), http)).toBe('answered')
})
