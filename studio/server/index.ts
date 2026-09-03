#!/usr/bin/env bun
/**
 * index.ts — the Domain Studio server entrypoint.
 *
 *   bun server/index.ts [path | --workspace dir] [--port n] [--open]
 *
 * `path` may be an astrale.config.ts, a domain dir, or a workspace to scan.
 * Boots a Bun HTTP server: serves the built SPA, the JSON API, and the SSE
 * stream; watches each domain's files for live re-render.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { setBridgePort } from './agent/bridge/grant'
import { probeInstalledHarnesses } from './agent/harness/registry'
import { handleApi } from './api'
import { buildGap } from './cache'
import { resolveTarget } from './detect'
import { allDomains } from './domain'
import { bootDomain } from './lifecycle'
import { broadcast, sseResponse } from './sse'
import { initWorkspaceState, stoppers } from './workspace-state'
import { watchWorkspace } from './workspace-watch'

const argv = process.argv.slice(2)
let target = ''
let port = Number(process.env.PORT) || 4319
// Default OFF — printing the URL is enough; popping a browser is invasive. The CLI
// owns browser-opening (its own --open), and always passes --no-open here.
let open = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--port') port = Number(argv[++i])
  else if (a === '--open') open = true
  else if (a === '--no-open') open = false
  else if (a === '--workspace') target = argv[++i]
  else if (!a.startsWith('--')) target = a
}
if (!target) target = process.cwd()

const domains = resolveTarget(target)
if (!domains.length) {
  console.error(`\n  ✗ No Astrale domains found at ${target}`)
  console.error(
    '    (looking for: astrale.config.ts + an Application whose schema binding resolves to authored source)\n',
  )
  process.exit(1)
}

console.log(`\n  Domain Studio — ${domains.length} domain(s)`)

const watchRoot = target.endsWith('astrale.config.ts') ? dirname(resolve(target)) : resolve(target)
initWorkspaceState(watchRoot) // where `create new` scaffolds + the create endpoint reads
let workspaceReady = false

/**
 * Bring every domain online WITHOUT holding the port shut.
 *
 * Indexing a domain bundles its schema in a subprocess — seconds each, and a
 * workspace holds a dozen. Doing that before `Bun.serve` made the terminal, and
 * then the browser, wait on work no first paint needs: `/api/workspace` answers
 * from the registry, and every other read builds what it asks for on demand. So
 * the server listens first and indexes behind it, announcing each domain as it
 * lands.
 *
 * TWO at a time, not more. Extraction is CPU-bound, so widening the fan-out does
 * not finish the workspace sooner — it only makes every individual domain later,
 * including the one the reader is looking at. On a cold workspace of twelve, four
 * abreast put the first canvas on screen after 24 s; two put it there after 2 s,
 * and the last domain landed at the same minute either way.
 */
const BOOT_CONCURRENCY = 2
async function indexWorkspace(): Promise<void> {
  console.log(`  indexing ${domains.length} domain(s)\n`)
  const queue = [...domains]
  let done = 0
  let failed = 0
  const progress = () =>
    `${String(++done).padStart(String(domains.length).length)}/${domains.length}`
  const worker = async (): Promise<void> => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      await buildGap() // a reader's own domain comes first
      try {
        const { origin, depsInstalled, renderFingerprint, stop } = await bootDomain(h, {
          background: true,
        })
        stoppers.set(h.id, stop)
        console.log(
          `    ${progress()}  ${origin}${depsInstalled ? '' : ' [deps not installed — static fallback]'}`,
        )
        broadcast({ type: 'schema-diff', domainId: h.id, renderFingerprint })
      } catch (error) {
        failed++
        console.error(
          `    ${progress()}  ✗ ${h.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BOOT_CONCURRENCY, queue.length) }, () => worker()),
  )
  broadcast({ type: 'workspace', domains: allDomains().map((domain) => domain.id) })

  // Ask each local agent whether it is here, before anything needs the answer: a
  // domain with no chat yet opens on the harness this machine actually has, and
  // that decision is made from synchronous code (see harness/selection).
  void probeInstalledHarnesses()

  // Keep the registry in sync with the workspace — pick up domains added/removed at
  // runtime. Started only once the initial set is live: it boots what `stoppers` does
  // not hold yet, and would otherwise re-boot every domain still being indexed.
  if (existsSync(watchRoot) && statSync(watchRoot).isDirectory())
    watchWorkspace(watchRoot, stoppers)

  console.log(
    `\n  ✓ workspace indexed — every canvas opens from cache now` +
      `${failed > 0 ? ` (${failed} failed, see above)` : ''}\n`,
  )
  // Flip readiness only after the progress block and its completion message have
  // been written. The supervising CLI cannot interleave its final success inside
  // the domain list anymore.
  workspaceReady = true
}

const DIST = process.env.DOMAIN_STUDIO_DIST || join(import.meta.dir, '..', 'client', 'dist')
const DEV = process.env.DOMAIN_STUDIO_DEV === '1'
const VITE = process.env.VITE_URL || 'http://localhost:5173'

/**
 * Gzip the text assets once and keep the result.
 *
 * The client ships ~1.2 MB of JavaScript and CSS. Their URLs are content-hashed
 * and therefore immutable, so one compression per process serves every reload,
 * every tab, and — the case that actually hurts — every browser reaching the
 * studio through a tunnel rather than loopback.
 */
const COMPRESSIBLE = /\.(?:js|css|html|json|svg|map)$/u
const gzipped = new Map<string, ArrayBuffer>()

function acceptsGzip(req: Request): boolean {
  return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
}

function staticBody(file: string, req: Request): { body: BodyInit; encoding?: string } {
  if (!acceptsGzip(req) || !COMPRESSIBLE.test(file)) return { body: Bun.file(file) }
  let held = gzipped.get(file)
  if (!held) {
    try {
      const packed = Bun.gzipSync(readFileSync(file))
      held = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength)
      gzipped.set(file, held)
    } catch {
      return { body: Bun.file(file) } // unreadable / already streaming fine
    }
  }
  return { body: held, encoding: 'gzip' }
}

function serveStatic(pathname: string, req: Request): Response {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
  const file = join(DIST, rel)
  if (existsSync(file) && !file.endsWith('/') && rel !== 'index.html') {
    // Vite emits content-hashed asset names (index-<hash>.js), so a given URL is
    // immutable — cache it forever. A rebuild produces a NEW name, and the
    // never-cached shell below points the browser at it.
    const { body, encoding } = staticBody(file, req)
    return new Response(body, {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-type': Bun.file(file).type,
        ...(encoding ? { 'content-encoding': encoding, vary: 'accept-encoding' } : {}),
      },
    })
  }
  const index = join(DIST, 'index.html')
  if (existsSync(index)) {
    // NEVER cache the HTML shell: it references the CURRENT hashed bundle. A stale
    // shell would point at an asset a later build deleted → 404 → the app never
    // boots and the page "loads forever". no-store guarantees every load is fresh.
    const { body, encoding } = staticBody(index, req)
    return new Response(body, {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'no-store',
        ...(encoding ? { 'content-encoding': encoding, vary: 'accept-encoding' } : {}),
      },
    })
  }
  return new Response(
    'client not built — run `vite build` (or set DOMAIN_STUDIO_DEV=1 for the Vite dev server)',
    { status: 500 },
  )
}

// Bind to loopback by default. Studio can trigger a LOCAL harness that edits code
// and runs commands with the configured access level — exposing the trigger on
// 0.0.0.0 would be RCE on the LAN. Power users behind a trusted tunnel can opt in
// via DOMAIN_STUDIO_HOST.
const HOST = process.env.DOMAIN_STUDIO_HOST || '127.0.0.1'
const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1'

const server = Bun.serve({
  port,
  hostname: HOST,
  // SSE + long agent turns hold connections open; Bun's 10s default would drop
  // them (and the live UI). 255s is Bun's max; the SSE hub also sends keepalives.
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/api/ready')
      return new Response(null, {
        status: workspaceReady ? 204 : 503,
        headers: { 'cache-control': 'no-store' },
      })
    if (url.pathname === '/api/events') return sseResponse(allDomains().map((d) => d.id))
    const apiRes = await handleApi(req, url, broadcast)
    if (apiRes) return apiRes
    if (DEV) {
      return fetch(VITE + url.pathname + url.search, {
        headers: req.headers,
        method: req.method,
      }).catch(() => new Response('Vite dev server not reachable', { status: 502 }))
    }
    return serveStatic(url.pathname, req)
  },
})

let shuttingDown = false
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  for (const stop of stoppers.values()) stop()
  server.stop(true)
  process.exit(signal === 'SIGINT' ? 130 : 143)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

setBridgePort(server.port ?? port)
const urlStr = `http://localhost:${server.port}`
console.log(`\n  ▸ ${urlStr}${DEV ? '  (dev proxy → Vite)' : ''}\n`)
if (!LOOPBACK) {
  console.warn(
    `  ⚠ SECURITY: bound to ${HOST} (not loopback). The Submit-to-agent trigger is the\n` +
      `    only thing standing between the network and an agent that edits code + runs shell\n` +
      `    with its configured access. Anyone who can reach this port can trigger it. Use only behind\n` +
      `    a trusted tunnel; unset DOMAIN_STUDIO_HOST to bind 127.0.0.1.\n`,
  )
}
if (open) {
  try {
    Bun.spawn(['open', urlStr])
  } catch {
    /* headless ok */
  }
}

// The port is open; everything below fills in behind it.
void indexWorkspace()
