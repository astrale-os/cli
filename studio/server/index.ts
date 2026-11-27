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
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { setBridgePort } from './agent/bridge/grant'
import { probeInstalledHarnesses } from './agent/harness/registry'
import { studioAudience, type Audience } from './api/guard'
import { broadcast } from './api/sse'
import { staticFiles } from './api/static'
import { bootDomain } from './domain/boot'
import { allDomains } from './domain/registry'
import { captureProcess } from './process'
import { studioFetch } from './serve'
import { initWorkspaceRoot, stoppers } from './workspace/root'
import { initStudioRuntime } from './workspace/runtime'
import { resolveTarget } from './workspace/scan'
import { publishSwitchOf } from './workspace/versions/context'
import { watchWorkspace } from './workspace/watch'

// before anything else: a Publish switch that is neither on nor off starts nothing
const publishSwitch = publishSwitchOf(process.env.ASTRALE_STUDIO_PUBLISH)
if ('problem' in publishSwitch) {
  console.error(`\n  ✗ ${publishSwitch.problem}\n`)
  process.exit(1)
}

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

const discoveryStarted = performance.now()
const domains = resolveTarget(target)
const discoveryMs = Math.round((performance.now() - discoveryStarted) * 10) / 10
if (!domains.length) {
  console.error(`\n  ✗ No Astrale domains found at ${target}`)
  console.error(
    '    (looking for: astrale.config.ts + a Domain definition whose schema binding resolves to authored source)\n',
  )
  process.exit(1)
}

console.log(`\n  Domain Studio — ${domains.length} domain(s)`)
if (!publishSwitch.publishing) console.log('    Publish is off (ASTRALE_STUDIO_PUBLISH=off)')
if (process.env.DOMAIN_STUDIO_TIMINGS === '1') {
  console.log(`    timing workspace discovery=${discoveryMs}ms`)
}

const watchRoot = target.endsWith('astrale.config.ts') ? dirname(resolve(target)) : resolve(target)
initWorkspaceRoot(watchRoot) // where `create new` scaffolds + the create endpoint reads
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
  const indexingStarted = performance.now()
  console.log(`  indexing ${domains.length} domain(s)\n`)
  const queue = [...domains]
  let done = 0
  let failed = 0
  const progress = () =>
    `${String(++done).padStart(String(domains.length).length)}/${domains.length}`
  const worker = async (): Promise<void> => {
    for (let h = queue.shift(); h; h = queue.shift()) {
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

  // Keep the registry in sync with the workspace — pick up domains added/removed at
  // runtime. Started only once the initial set is live: it boots what `stoppers` does
  // not hold yet, and would otherwise re-boot every domain still being indexed.
  if (existsSync(watchRoot) && statSync(watchRoot).isDirectory())
    watchWorkspace(watchRoot, stoppers)

  console.log(
    `\n  ✓ workspace indexed — every canvas opens from cache now` +
      `${failed > 0 ? ` (${failed} failed, see above)` : ''}` +
      `${process.env.DOMAIN_STUDIO_TIMINGS === '1' ? ` — ${Math.round(performance.now() - indexingStarted)}ms` : ''}\n`,
  )
  // Flip readiness only after the progress block and its completion message have
  // been written, so the supervising CLI never interleaves its success inside them.
  workspaceReady = true
}

const DIST = process.env.DOMAIN_STUDIO_DIST || join(import.meta.dir, '..', 'client', 'dist')
const DEV = process.env.DOMAIN_STUDIO_DEV === '1'
const VITE = process.env.VITE_URL || 'http://localhost:5173'

const serveStatic = staticFiles(DIST)

// Bind to loopback by default. Studio can trigger a LOCAL harness that edits code
// and runs commands with the configured access level — exposing the trigger on
// 0.0.0.0 would be RCE on the LAN. DOMAIN_STUDIO_HOST binds another address; the
// guard (api/guard.ts) then answers requests that name that address too, and no
// other host name: a tunnel that forwards its own public name is refused.
const HOST = process.env.DOMAIN_STUDIO_HOST || '127.0.0.1'
const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1'

const audienceAt = (boundPort: number): Audience =>
  studioAudience({ port: boundPort, boundHost: HOST, ...(DEV ? { devOrigin: VITE } : {}) })
// Who may drive the server is known once its port is: read per request, set right after binding.
let audience = audienceAt(port)
const server = Bun.serve({
  port,
  hostname: HOST,
  // SSE + long agent turns hold connections open; Bun's 10s default would drop
  // them (and the live UI). 255s is Bun's max; the SSE hub also sends keepalives.
  idleTimeout: 255,
  fetch: studioFetch({
    audience: () => audience,
    ready: () => workspaceReady,
    domains: () => allDomains().map((d) => d.id),
    notify: broadcast,
    ...(DEV ? { vite: VITE } : {}),
    serveStatic,
  }),
})
audience = audienceAt(server.port ?? port)

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
initStudioRuntime(resolve(target), server.port ?? port)
const urlStr = `http://localhost:${server.port}`
console.log(`\n  ▸ ${urlStr}${DEV ? '  (dev proxy → Vite)' : ''}\n`)
if (!LOOPBACK) {
  console.warn(
    `  ⚠ SECURITY: bound to ${HOST} (not loopback). The Submit-to-agent trigger is the\n` +
      `    only thing standing between the network and an agent that edits code + runs shell\n` +
      `    with its configured access. Anyone who can reach this port as ${HOST} can trigger it.\n` +
      `    Unset DOMAIN_STUDIO_HOST to bind 127.0.0.1.\n`,
  )
}
if (open) {
  try {
    void captureProcess(['open', urlStr], { timeoutMs: 10_000 })
  } catch {
    /* headless ok */
  }
}

// The port is open; everything below fills in behind it.
// Start the agent probes first. They are logically independent from schema
// introspection, but both launch subprocesses; giving ACP the first scheduling
// turn prevents CPU-heavy background extraction from stretching "Connecting…"
// across the whole workspace index.
void probeInstalledHarnesses()
void indexWorkspace()
