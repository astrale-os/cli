import { Hono } from 'hono'
import { join } from 'node:path'

import type { KernelRuntime, GraphAdapter } from '@astrale-os/kernel-runtime'
import { createWsRoute, websocket } from '@astrale-os/kernel-server/hono/ws'
import { queryGraphState } from '@astrale-os/kernel-toolkit/telemetry'

import { resolvePlaygroundDir, MIME_TYPES } from './playground'

export interface DevServerOptions {
  kernel: KernelRuntime
  graphAdapter: GraphAdapter
  distribution: { name: string; version?: string; schema: unknown }
  operationCount: number
}

export interface DevServerHandle {
  stop: () => void
  playgroundAvailable: boolean
}

/**
 * Create and start the dev Hono app with health, API, WebSocket, and optional
 * playground routes. Returns a server handle.
 */
export function startDevServer(options: DevServerOptions, port: number): DevServerHandle {
  const { kernel, graphAdapter, distribution, operationCount } = options

  const playgroundDir = resolvePlaygroundDir()
  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.get('/api/schema', (c) => c.json(distribution.schema))
  app.get('/api/info', (c) =>
    c.json({
      name: distribution.name,
      version: distribution.version ?? '0.0.0',
      operations: operationCount,
    }),
  )
  app.get('/api/graph-state', async (c) => {
    try {
      const state = await queryGraphState(graphAdapter)
      return c.json(state)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Failed to query graph state' }, 500)
    }
  })
  app.get('/ws', createWsRoute(kernel))

  // Proxy to Vite dev server if running, otherwise serve static dist/
  const viteDevUrl = 'http://localhost:3200'
  let viteAvailable: boolean | null = null

  async function isViteRunning(): Promise<boolean> {
    if (viteAvailable !== null) return viteAvailable
    try {
      const res = await fetch(viteDevUrl, { method: 'HEAD', signal: AbortSignal.timeout(500) })
      viteAvailable = res.ok
    } catch {
      viteAvailable = false
    }
    // Re-check every 10s so it picks up Vite starting/stopping
    setTimeout(() => {
      viteAvailable = null
    }, 10_000)
    return viteAvailable
  }

  app.get('/*', async (c) => {
    // Try Vite dev server first (hot-reloading, no rebuild needed)
    if (await isViteRunning()) {
      try {
        const url = new URL(c.req.url)
        const viteUrl = `${viteDevUrl}${url.pathname}${url.search}`
        const res = await fetch(viteUrl, {
          headers: c.req.raw.headers,
          signal: AbortSignal.timeout(5000),
        })
        return new Response(res.body, {
          status: res.status,
          headers: res.headers,
        })
      } catch {
        // Vite request failed, fall through to static
      }
    }

    // Fall back to built dist/
    if (playgroundDir) {
      const reqPath = c.req.path === '/' ? '/index.html' : c.req.path
      const file = Bun.file(join(playgroundDir, reqPath))
      if (await file.exists()) {
        const ext = reqPath.substring(reqPath.lastIndexOf('.'))
        return new Response(file, {
          headers: { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' },
        })
      }
      // SPA fallback
      return new Response(Bun.file(join(playgroundDir, 'index.html')), {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return c.text('Playground not available', 404)
  })

  try {
    const server = Bun.serve({
      port,
      hostname: '0.0.0.0',
      fetch: app.fetch,
      websocket,
    })

    return {
      stop: () => server.stop(),
      playgroundAvailable: !!playgroundDir,
    }
  } catch (err) {
    throw new Error(
      `Failed to start server on port ${port}. ${err instanceof Error ? err.message : ''}\n` +
        `Is port ${port} already in use? Try: astrale dev --port ${port + 1}`,
    )
  }
}
