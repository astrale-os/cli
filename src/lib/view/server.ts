import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'

import type { ViewServeConfig } from './session'

import { withKernelClient } from '../../kernel'
import { fetchWithCaFile } from '../../kernel/ca-fetch'
import { removeSessionFiles } from './session'

/**
 * The view-session server: serves the host page, hands it config and fresh
 * credentials, receives its lifecycle reports, and proxies the view's kernel
 * calls (one mechanism for CORS, self-signed local CAs, and keeping the kernel
 * origin out of the page). Everything is nonce-scoped under `/s/<nonce>/`;
 * loopback-only. Exits after `idleMs` without a request — the host page's
 * heartbeat keeps a live session alive.
 */

const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000
const FALLBACK_TOKEN_TTL_MS = 3600_000
const IDLE_SWEEP_MS = 60_000

export type PageStatus = { state: string; error?: string; at: string }

type TokenGrant = { token: string; expiresAt: number; kind: 'minted' | 'raw' }

export function startViewServer(config: ViewServeConfig): Server {
  const { session, proxy } = config
  const base = `/s/${session.nonce}`
  const hostDir = viewerDistDir()
  const proxyFetch = proxy.caFile ? fetchWithCaFile(proxy.caFile) : globalThis.fetch
  let status: PageStatus = { state: 'waiting', at: new Date().toISOString() }
  let grant: TokenGrant | null = null
  let lastActivity = Date.now()

  /**
   * Prefer a kernel-minted TTL-bound identity credential (what the GUI hands
   * its iframes); fall back to the raw CLI credential so the session works
   * anywhere the CLI itself can call.
   */
  async function freshGrant(): Promise<TokenGrant> {
    if (grant && grant.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) return grant
    grant = await withKernelClient(config.kernel, async (ctx) => {
      try {
        const token = await ctx.client.as(ctx.credential).auth.mint()
        return {
          token,
          expiresAt: jwtExpiry(token) ?? Date.now() + FALLBACK_TOKEN_TTL_MS,
          kind: 'minted' as const,
        }
      } catch (error) {
        console.log(
          `mint failed (${error instanceof Error ? error.message : String(error)}) — falling back to the raw CLI credential`,
        )
        const token = ctx.credential
        return {
          token,
          expiresAt: jwtExpiry(token) ?? Date.now() + FALLBACK_TOKEN_TTL_MS,
          kind: 'raw' as const,
        }
      }
    })
    return grant
  }

  const server = createServer((req, res) => {
    lastActivity = Date.now()
    void route(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      // CORS headers even on failures — the caller may be the cross-origin
      // view iframe, and an opaque error reads as a network failure there.
      if (!res.headersSent) {
        res.writeHead(502, {
          'content-type': 'application/json',
          ...corsHeaders(req.headers.origin),
        })
      }
      res.end(JSON.stringify({ error: message }))
    })
  })

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(`${base}/`) && url.pathname !== base) {
      res.writeHead(404).end()
      return
    }
    const sub = url.pathname.slice(base.length) || '/'

    if (sub === '/k' || sub.startsWith('/k/')) {
      await proxyKernel(req, res, sub.slice('/k'.length), url.search)
      return
    }
    if (sub === '/' || sub === '/index.html') {
      await serveAsset(res, join(hostDir, 'index.html'), 'text/html; charset=utf-8')
      return
    }
    if (sub === '/main.js') {
      await serveAsset(res, join(hostDir, 'main.js'), 'text/javascript; charset=utf-8')
      return
    }
    if (sub === '/config.json' && req.method === 'GET') {
      json(res, 200, {
        viewUrl: session.view.url,
        viewPath: session.view.path ?? null,
        viewName: session.view.name ?? null,
        functionId: session.view.functionId,
        handshake: session.view.handshake,
        targetNodeId: session.target?.id ?? null,
        targetPath: session.target?.path ?? null,
        kernelUrl: proxy.direct ? proxy.kernelUrl : `${base}/k`,
        identity: session.identity ?? null,
        instance: session.instance ?? null,
        sessionId: session.id,
      })
      return
    }
    if (sub === '/token' && req.method === 'POST') {
      const fresh = await freshGrant()
      json(res, 200, { token: fresh.token, expiresAt: fresh.expiresAt, kind: fresh.kind })
      return
    }
    if (sub === '/status' && req.method === 'POST') {
      const body = await readJson(req)
      if (body && typeof body.state === 'string' && body.state !== 'alive') {
        status = { state: body.state, error: asString(body.error), at: new Date().toISOString() }
      }
      res.writeHead(204).end()
      return
    }
    if (sub === '/state' && req.method === 'GET') {
      json(res, 200, status)
      return
    }
    res.writeHead(404).end()
  }

  /** Forward a kernel call: verbatim headers/body both ways, CORS added. */
  async function proxyKernel(
    req: IncomingMessage,
    res: ServerResponse,
    suffix: string,
    search: string,
  ): Promise<void> {
    const origin = req.headers.origin
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(origin)).end()
      return
    }
    const target = joinUrl(proxy.kernelUrl, suffix) + search
    const headers: Record<string, string> = {}
    for (const name of ['authorization', 'content-type', 'accept']) {
      const value = req.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    // Buffer the request body (envelope requests are small JSON): the caFile
    // fetch path speaks node https and cannot consume a web-stream body.
    // Response bodies still stream through.
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const body = hasBody ? Buffer.concat(await collect(req)) : undefined
    const upstream = await proxyFetch(target, {
      method: req.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    } as RequestInit)
    const responseHeaders: Record<string, string> = corsHeaders(origin)
    const contentType = upstream.headers.get('content-type')
    if (contentType) responseHeaders['content-type'] = contentType
    res.writeHead(upstream.status, responseHeaders)
    if (upstream.body) {
      Readable.fromWeb(upstream.body as unknown as WebReadableStream).pipe(res)
    } else {
      res.end()
    }
  }

  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > config.idleMs) void shutdown(0)
  }, IDLE_SWEEP_MS)
  idleTimer.unref()

  async function shutdown(code: number): Promise<void> {
    clearInterval(idleTimer)
    server.close()
    await removeSessionFiles(session.id)
    process.exit(code)
  }
  process.on('SIGTERM', () => void shutdown(0))
  process.on('SIGINT', () => void shutdown(0))

  server.listen(session.port, '127.0.0.1')
  return server
}

/**
 * The prebuilt host-page bundle, shipped next to the CLI entry
 * (`<pkg>/viewer/dist`). Dev runs (bun, no dist) build it on demand.
 */
export function viewerDistDir(): string {
  const override = process.env.ASTRALE_VIEWER_DIR
  if (override) return override
  return join(dirname(process.argv[1] ?? '.'), '..', 'viewer', 'dist')
}

/** Ensure the host bundle exists; on a dev checkout, build it with Bun. */
export async function ensureViewerAssets(): Promise<string> {
  const dist = viewerDistDir()
  if (existsSync(join(dist, 'main.js')) && existsSync(join(dist, 'index.html'))) return dist
  const srcDir = join(dist, '..')
  const bun = (
    globalThis as { Bun?: { build: (o: object) => Promise<{ success: boolean; logs: unknown[] }> } }
  ).Bun
  if (bun && existsSync(join(srcDir, 'main.ts'))) {
    const result = await bun.build({
      entrypoints: [join(srcDir, 'main.ts')],
      outdir: dist,
      target: 'browser',
      minify: false,
    })
    if (!result.success) throw new Error(`viewer build failed: ${result.logs.join('\n')}`)
    const { copyFile } = await import('node:fs/promises')
    await copyFile(join(srcDir, 'index.html'), join(dist, 'index.html'))
    return dist
  }
  throw new Error(
    `viewer bundle missing at ${dist} — reinstall the CLI (or run \`bun scripts/build.ts\` in a dev checkout)`,
  )
}

function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
      exp?: number
    }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept',
    // Chrome private-network-access preflight (public page → loopback proxy).
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '600',
    vary: 'origin',
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  if (!suffix) return baseUrl
  return baseUrl.replace(/\/$/, '') + suffix
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function serveAsset(res: ServerResponse, file: string, contentType: string): Promise<void> {
  try {
    const content = await readFile(file)
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
    res.end(content)
  } catch {
    res.writeHead(404).end()
  }
}

async function collect(req: IncomingMessage): Promise<Buffer[]> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return chunks
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(Buffer.concat(await collect(req)).toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
