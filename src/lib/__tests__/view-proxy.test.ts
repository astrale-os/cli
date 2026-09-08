import { expect, test } from 'bun:test'
import { once } from 'node:events'
import { createServer, get, type RequestListener, type Server } from 'node:http'

import type { ViewServeConfig } from '../view/session'

import { startViewServer } from '../view/server'

async function proxy(origin: RequestListener) {
  const upstream = createServer(origin)
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const url = address(upstream)
  const server = startViewServer({
    session: {
      id: 'v-proxy',
      pid: 0,
      port: 0,
      nonce: 'proxy',
      pageUrl: '',
      createdAt: '',
      view: {
        target: '/:example.test' as ViewServeConfig['session']['view']['target'],
        route: {
          key: 'example.test:view.public',
          href: 'https://example.test/view',
          handshake: 'none',
          issuer: 'https://example.test' as ViewServeConfig['session']['view']['route']['issuer'],
          etag: `sha256:${'a'.repeat(64)}`,
          revision:
            `sha256:${'b'.repeat(64)}` as ViewServeConfig['session']['view']['route']['revision'],
          declaration: { target: { kind: 'domain' } },
        },
      },
    },
    kernel: {},
    proxy: { kernelUrl: url, issuer: url, direct: false },
    externalOrigins: [],
    idleMs: 120_000,
  })
  await once(server, 'listening')
  return {
    url: `${address(server)}/s/proxy/k`,
    close() {
      for (const listener of [server, upstream]) {
        listener.closeAllConnections()
        listener.close()
      }
    },
  }
}

function address(server: Server): string {
  const value = server.address()
  if (value === null || typeof value === 'string') throw new Error('Missing HTTP address')
  return `http://127.0.0.1:${value.port}`
}

async function within(promise: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('HTTP stream did not settle')), 500)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

test('View proxy preserves complete response bytes and CORS', async () => {
  const fixture = await proxy((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.write(new Uint8Array([0, 255]))
    res.end(new Uint8Array([1, 2]))
  })
  try {
    const response = await fetch(fixture.url, { headers: { origin: 'https://example.test' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://example.test')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 1, 2])
  } finally {
    await fixture.close()
  }
})

test.each([false, true])(
  'View proxy cancels upstream after client closes (headers: %s)',
  async (headers) => {
    const started = Promise.withResolvers<void>()
    const closed = Promise.withResolvers<void>()
    const fixture = await proxy((_req, res) => {
      res.on('close', () => closed.resolve())
      if (headers) {
        res.writeHead(200)
        res.write('first')
      }
      started.resolve()
    })
    const request = get(fixture.url)
    request.on('error', () => {})
    try {
      if (headers) {
        const [response] = await once(request, 'response')
        await once(response, 'data')
        response.destroy()
      } else {
        await started.promise
        request.destroy()
      }
      await within(closed.promise)
    } finally {
      request.destroy()
      await fixture.close()
    }
  },
)

test('View proxy terminates a failed upstream body without appending a JSON error', async () => {
  const stop = Promise.withResolvers<void>()
  const fixture = await proxy((_req, res) => {
    res.writeHead(200, { 'content-length': 100, 'content-type': 'application/octet-stream' })
    res.write('first')
    void stop.promise.then(() => res.socket?.destroy())
  })
  const request = get(fixture.url)
  request.on('error', () => {})
  try {
    const [response] = await once(request, 'response')
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    const errored = new Promise<void>((resolve) => response.once('error', () => resolve()))
    await once(response, 'data')
    stop.resolve()
    await within(errored)
    expect(Buffer.concat(chunks).toString()).toBe('first')
    expect(response.complete).toBe(false)
    expect((await fetch(fixture.url.replace('/k', '/state'))).status).toBe(200)
  } finally {
    stop.resolve()
    request.destroy()
    await fixture.close()
  }
})
