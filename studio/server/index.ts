#!/usr/bin/env bun
/**
 * index.ts — the Domain Studio server entrypoint.
 *
 *   bun server/index.ts [path | --workspace dir] [--port n] [--schema-dir schema] [--open]
 *
 * `path` may be an astrale.config.ts, a domain dir, or a workspace to scan.
 * Boots a Bun HTTP server: serves the built SPA, the JSON API, and the SSE
 * stream; watches each domain's files for live re-render.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { setBridgePort } from './agent/bridge/grant'
import { handleApi } from './api'
import { resolveTarget } from './detect'
import { allDomains } from './domain'
import { bootDomain } from './lifecycle'
import { broadcast, sseResponse } from './sse'
import { shutdownViewDevServers } from './view-dev-server'
import { initWorkspaceState, stoppers } from './workspace-state'
import { watchWorkspace } from './workspace-watch'

const argv = process.argv.slice(2)
let target = ''
let port = Number(process.env.PORT) || 4319
let schemaDir = 'schema'
// Default OFF — printing the URL is enough; popping a browser is invasive. The CLI
// owns browser-opening (its own --open), and always passes --no-open here.
let open = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--port') port = Number(argv[++i])
  else if (a === '--schema-dir') schemaDir = argv[++i]
  else if (a === '--open') open = true
  else if (a === '--no-open') open = false
  else if (a === '--workspace') target = argv[++i]
  else if (!a.startsWith('--')) target = a
}
if (!target) target = process.cwd()

const domains = resolveTarget(target, schemaDir)
if (!domains.length) {
  console.error(`\n  ✗ No Astrale domains found at ${target}`)
  console.error(
    `    (looking for the triple: astrale.config.ts + domain.ts + ${schemaDir}/index.ts)\n`,
  )
  process.exit(1)
}

console.log(`\n  Domain Studio — indexing ${domains.length} domain(s):`)
for (const h of domains) {
  const { origin, depsInstalled, stop } = await bootDomain(h)
  stoppers.set(h.id, stop)
  console.log(`    • ${origin}${depsInstalled ? '' : ' [deps not installed — static fallback]'}`)
}

// keep the registry in sync with the workspace — pick up domains added/removed at runtime
const watchRoot = target.endsWith('astrale.config.ts') ? dirname(resolve(target)) : resolve(target)
initWorkspaceState(watchRoot, schemaDir) // where `create new` scaffolds + the create endpoint reads
if (existsSync(watchRoot) && statSync(watchRoot).isDirectory())
  watchWorkspace(watchRoot, schemaDir, stoppers)

const DIST = process.env.DOMAIN_STUDIO_DIST || join(import.meta.dir, '..', 'client', 'dist')
const DEV = process.env.DOMAIN_STUDIO_DEV === '1'
const VITE = process.env.VITE_URL || 'http://localhost:5173'

function serveStatic(pathname: string): Response {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
  const file = join(DIST, rel)
  if (existsSync(file) && !file.endsWith('/') && rel !== 'index.html') {
    // Vite emits content-hashed asset names (index-<hash>.js), so a given URL is
    // immutable — cache it forever. A rebuild produces a NEW name, and the
    // never-cached shell below points the browser at it.
    return new Response(Bun.file(file), {
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    })
  }
  const index = join(DIST, 'index.html')
  if (existsSync(index))
    // NEVER cache the HTML shell: it references the CURRENT hashed bundle. A stale
    // shell would point at an asset a later build deleted → 404 → the app never
    // boots and the page "loads forever". no-store guarantees every load is fresh.
    return new Response(Bun.file(index), {
      headers: { 'content-type': 'text/html', 'cache-control': 'no-store' },
    })
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
    if (url.pathname === '/api/events') return sseResponse(allDomains().map((d) => d.id))
    const apiRes = await handleApi(req, url, broadcast)
    if (apiRes) return apiRes
    if (DEV) {
      return fetch(VITE + url.pathname + url.search, {
        headers: req.headers,
        method: req.method,
      }).catch(() => new Response('Vite dev server not reachable', { status: 502 }))
    }
    return serveStatic(url.pathname)
  },
})

let shuttingDown = false
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await shutdownViewDevServers()
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
