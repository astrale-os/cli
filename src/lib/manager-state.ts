import type { Kernel } from '@astrale-os/kernel-host'
import type { inProcessManager } from '@astrale-os/kernel-host/drivers'
import type { JWK } from 'jose'

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

/**
 * Local extension of `InProcessManagerConfig` so the CLI can type-check the
 * `admin: { ... }` field it passes to `inProcessManager`. The field is not yet
 * declared in `kernel-host` v0.7.0 — it lives on a divergent upstream branch
 * (commit 1cf9e915). When the upstream lands the type, drop this alias and the
 * `as ManagerConfigWithAdmin` cast below; the call site keeps the same shape.
 *
 * Shape mirrors what is actually constructed at the call site — keep them in
 * sync; the cast is the only thing protecting against silent drift.
 */
type InProcessManagerConfigArg = Parameters<typeof inProcessManager>[0]
type ManagerConfigWithAdmin = InProcessManagerConfigArg & {
  admin: {
    builtinDomains?: { distribution?: { spec: Record<string, unknown>; workerKey: JWK } }
    installDistributionOnManager?: boolean
    workflow: {
      defaultHost: { id: string; url: string; kind: 'local'; label: string }
      childDefaults: {
        host: string
        port: number
        issuerFor: (id: string) => string
        graphNameFor: (id: string) => string
      }
      keyStore: {
        ensureKernelKey(input: { issuer: string; subject: string; kid?: string }): Promise<{
          auth: unknown
          kid: string
          alg: string
          publicJwk: Record<string, unknown>
          secretRef: string
        }>
        readPrivateJwk?(secretRef: string): Promise<Record<string, unknown>>
      }
    }
  }
}

import type { AstraleConfig } from './config'

import { resolveBuiltinDomain } from './builtin-domains'
import { isInContainer } from './env'
import { keypairPaths, resolveAuth } from './keys'
import { log } from './log'
import { JOURNAL_PATH, KEYS_DIR, LOGS_DIR, MANAGER_PID_PATH } from './paths'

export type ManagerState = {
  running: boolean
  /** PID of the manager process (if detected via PID file or HTTP). */
  pid?: number
  /** How the running state was detected. */
  source: 'http' | 'pid' | 'none'
}

/**
 * Detect whether the Astrale manager is running.
 *
 * Strategy:
 * 1. HTTP probe against the manager URL — this works for both foreground
 *    and background runs and is the authoritative signal.
 * 2. Read the PID file as a secondary source of the PID (written in both
 *    foreground and background modes) and to salvage a stale match if HTTP
 *    fails.
 *
 * A stale PID file (pointing to a dead process) is treated as "not running".
 */
export async function detectManagerState(config: AstraleConfig): Promise<ManagerState> {
  const url = `http://localhost:${config.managerPort}/mngt`
  const [alive, pid] = await Promise.all([probeHttp(url), readManagerPid()])

  if (alive) return { running: true, pid, source: 'http' }
  if (pid !== undefined) return { running: true, pid, source: 'pid' }
  return { running: false, source: 'none' }
}

/**
 * Write the current process PID to the manager PID file.
 */
export async function writeManagerPid(pid: number = process.pid): Promise<void> {
  await writeFile(MANAGER_PID_PATH, String(pid))
}

/**
 * Remove the manager PID file if present. Safe to call if the file is missing.
 */
export async function removeManagerPid(): Promise<void> {
  try {
    await unlink(MANAGER_PID_PATH)
  } catch {
    // File doesn't exist — nothing to clean up.
  }
}

async function readManagerPid(): Promise<number | undefined> {
  try {
    const raw = await readFile(MANAGER_PID_PATH, 'utf-8')
    const parsed = parseInt(raw.trim(), 10)
    if (!Number.isFinite(parsed)) return undefined
    try {
      // Signal 0 — probe liveness without delivering a signal.
      process.kill(parsed, 0)
      return parsed
    } catch {
      // Process is gone — stale PID file.
      return undefined
    }
  } catch {
    return undefined
  }
}

async function readPrivateJwkFromSecretRef(
  secretRef: string,
  allowedRoot: string,
): Promise<Record<string, unknown>> {
  const filePath = secretRef.startsWith('file://') ? fileURLToPath(secretRef) : secretRef
  const root = resolve(allowedRoot)
  const target = resolve(filePath)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Private key secretRef is outside the configured key store: ${secretRef}`)
  }
  return JSON.parse(await readFile(target, 'utf-8')) as Record<string, unknown>
}

/**
 * Best-effort kill of the host-mode manager process. Reads the PID file,
 * sends SIGTERM, polls for exit up to ~2s, then SIGKILLs if still alive.
 * Removes the PID file on the way out. Used by `astrale reset --hard`;
 * never throws. Returns true if a live process was signaled.
 */
export async function forceStopManager(timeoutMs = 2_000): Promise<boolean> {
  const pid = await readManagerPid()
  await removeManagerPid()
  if (pid === undefined) return false
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* exited between checks — fine */
  }
  return true
}

/**
 * Start the Astrale manager kernel and bind HTTP.
 *
 * Composition:
 *   - `storage: falkordb(...)` — manager's own graph (holds manager domain + child registry).
 *   - `manager: inProcessManager(...)` — enables multi-instance mode. The driver
 *     installs `ManagerSchema` (`KernelInstance/*`) into the manager graph and
 *     mounts the multiplex routes (`/mngt` for manager dispatch, `/:id/` for
 *     child direct access, per-instance JWKS).
 *   - `transports: [node()]` — single Node HTTP server hosting everything.
 *
 * The child `spawn` callback boots each sub-kernel with its own `falkordb`
 * graph on-demand (lazy; only when `/:id/*` is hit or an explicit
 * `KernelInstance/boot` call arrives).
 */
/**
 * Install process-level guards so a stray async rejection from any domain or
 * child kernel cannot kill the manager process. Host-mode runs no supervisor,
 * so we log and KEEP RUNNING rather than exit (a dead manager takes down every
 * mounted instance — worse than the rejection itself).
 *
 * Idempotent (no-op on repeat). Call this from the LONG-LIVED entry points
 * (`manager-entrypoint.ts`, `commands/start.ts` foreground branch) AFTER
 * `startManager` resolves — boot-time failures must still propagate so the
 * entry process exits visibly instead of zombieing. One-shot CLI flows
 * (`commands/reset.ts`) must NOT install the guards — they need a clean
 * non-zero exit on stray rejections, not a swallow.
 */
let processGuardsRegistered = false
export function registerProcessGuards(): void {
  if (processGuardsRegistered) return
  processGuardsRegistered = true
  // Named function expressions so tests can structurally assert exactly one
  // guard per event via `process.listeners(...).filter(h => h.name === ...)`.
  process.on('unhandledRejection', function astraleManagerGuardRejection(reason) {
    safeLog('unhandledRejection', formatReason(reason))
  })
  process.on('uncaughtException', function astraleManagerGuardException(err) {
    safeLog('uncaughtException', err.stack ?? err.message)
  })
}

function formatReason(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message
  if (typeof reason === 'string') return reason
  return inspect(reason, { depth: 3, breakLength: 200 })
}

function safeLog(event: string, detail: string): void {
  try {
    log.error(`[manager] ${event} (ignored, manager kept alive): ${detail}`)
  } catch {
    // stderr may be closed (detached child losing parent pipe); swallowing
    // here keeps the guard from escalating to a hard abort.
  }
}

export async function startManager(config: AstraleConfig): Promise<Kernel> {
  const auth = await resolveAuth(KEYS_DIR, {
    issuer: config.issuer,
    subject: 'manager',
  })
  const { Kernel, falkordb, inProcessManager, node, ndjsonJournal } =
    await import('@astrale-os/kernel-host')
  const { deleteGraphIfExists } = await import('@astrale-os/kernel-adapters/falkordb')

  // Wipe a child's FalkorDB graph using the MANAGER's falkor config — never
  // the child's persisted `host` (often `localhost`, which doesn't resolve to
  // FalkorDB when the manager runs in a container; compose alias is
  // `falkordb`). `deleteGraphIfExists` is idempotent on a missing graph, so
  // delete and double-delete don't error.
  const teardownGraph = (graphName: string): Promise<void> =>
    deleteGraphIfExists({ graphName, host: config.falkorHost, port: config.falkorPort })

  // Resolve builtin domain specs + worker keys once at startup for
  // the admin create workflow. If resolution fails, the manager still starts —
  // only admin requests that ask for distribution installation will surface a
  // clean error at call time.
  const adminBuiltinDomains = await loadBuiltinDomainsCatalog()

  const kernel = new Kernel({
    mode: 'manager',
    publicUrl: config.issuer,
    id: 'manager',
    auth,
    drivers: {
      storage: falkordb({
        graphName: config.graphName,
        host: config.falkorHost,
        port: config.falkorPort,
      }),
      transports: [node()],
      observability: ndjsonJournal({ path: JOURNAL_PATH, tags: { kernel: 'manager' } }),
      manager: inProcessManager({
        admin: {
          builtinDomains: adminBuiltinDomains,
          installDistributionOnManager: adminBuiltinDomains?.distribution !== undefined,
          views: {
            workerUrl: process.env.ADMIN_WORKER_URL ?? 'http://localhost:8845',
          },
          workflow: {
            defaultHost: {
              id: 'local',
              url: config.issuer,
              kind: 'local',
              label: 'Local manager',
            },
            childDefaults: {
              host: 'localhost',
              port: config.falkorPort,
              issuerFor: (id) => `http://localhost:${config.managerPort}/${id}`,
              graphNameFor: (id) => `${id}-graph`,
            },
            keyStore: {
              async ensureKernelKey(input) {
                const auth = await resolveAuth(KEYS_DIR, {
                  issuer: input.issuer,
                  subject: input.subject,
                  kid: input.kid,
                })
                const { privatePath } = keypairPaths(input.subject, KEYS_DIR)
                const jwk = auth.publicKey.jwk as Record<string, unknown>
                return {
                  auth,
                  kid:
                    typeof jwk.kid === 'string' ? jwk.kid : (input.kid ?? `${input.subject}-key`),
                  alg: typeof jwk.alg === 'string' ? jwk.alg : 'ES256',
                  publicJwk: jwk,
                  secretRef: `file://${privatePath}`,
                }
              },
              async readPrivateJwk(secretRef) {
                return readPrivateJwkFromSecretRef(secretRef, KEYS_DIR)
              },
            },
          },
        },
        async spawn(_parent, cfg) {
          const childUrl = cfg.issuer ?? `http://localhost:${config.managerPort}/${cfg.id}`
          // Load (or lazily generate) the per-instance keypair. The CLI
          // pre-generates this at `astrale instance create`; for legacy
          // instances registered without CLI keygen, `resolveAuth` falls
          // back to a fresh keypair written on disk under the instance's
          // id — subsequent calls with `-i <id>` then target this key.
          const childAuth = await resolveAuth(KEYS_DIR, {
            issuer: childUrl,
            subject: cfg.id,
          })
          const child = new Kernel({
            publicUrl: childUrl,
            id: cfg.id,
            auth: childAuth,
            drivers: {
              // Children share the manager's FalkorDB connection. `cfg.host`
              // is persisted at register time (often "localhost") but in
              // docker-mode the manager reaches FalkorDB via the compose
              // network alias (`falkordb`). The manager's `config.falkorHost`
              // is the source of truth — inherit it here.
              storage: falkordb({
                graphName: cfg.graphName,
                host: config.falkorHost,
                port: config.falkorPort,
              }),
              observability: ndjsonJournal({
                path: join(LOGS_DIR, cfg.id, 'events.ndjson'),
                tags: { kernel: cfg.id },
              }),
            },
          })
          await child.boot()
          return {
            kernel: child,
            disposer: () => teardownGraph(cfg.graphName),
          }
        },
        // Durable storage teardown, reachable from `delete` without a live
        // handle (the spawn disposer only exists for instances mounted this
        // process). Same wipe as the disposer — one code path.
        teardown: teardownGraph,
      } as ManagerConfigWithAdmin),
    },
  })
  // In container mode, bind to 0.0.0.0 so the Docker port mapping
  // (127.0.0.1:4400→container:4400) can reach the listener. On host-mode
  // the default (bun's localhost) is correct.
  const container = isInContainer()
  await kernel.listen({
    port: config.managerPort,
    ...(container ? { hostname: '0.0.0.0' } : {}),
  })

  // Skip the host PID file when running inside the `manager` container —
  // the PID file is a host-mode concern (used by `astrale stop` to signal
  // the bun process). In container mode, docker tracks the lifecycle.
  if (!container) {
    await writeManagerPid(process.pid)
  }
  return kernel
}

/**
 * Resolve the distribution builtin (spec + worker key) and return it in
 * the shape the admin extension expects. Silently returns `undefined` when
 * the builtin can't be resolved — the manager remains usable; only admin
 * create requests asking for distribution installation will reject clearly.
 */
async function loadBuiltinDomainsCatalog(): Promise<
  | {
      aiGateway?: { spec: Record<string, unknown>; workerKey: JWK }
      distribution?: { spec: Record<string, unknown>; workerKey: JWK }
    }
  | undefined
> {
  try {
    const [aiGateway, dist] = await Promise.all([
      resolveBuiltinDomain('ai-gateway'),
      resolveBuiltinDomain('distribution'),
    ])
    const [aiGatewaySpecRaw, aiGatewayKeyRaw, distSpecRaw, distKeyRaw] = await Promise.all([
      readFile(aiGateway.specPath, 'utf-8'),
      readFile(aiGateway.keyPath, 'utf-8'),
      readFile(dist.specPath, 'utf-8'),
      readFile(dist.keyPath, 'utf-8'),
    ])
    return {
      aiGateway: {
        spec: JSON.parse(aiGatewaySpecRaw) as Record<string, unknown>,
        workerKey: JSON.parse(aiGatewayKeyRaw) as JWK,
      },
      distribution: {
        spec: JSON.parse(distSpecRaw) as Record<string, unknown>,
        workerKey: JSON.parse(distKeyRaw) as JWK,
      },
    }
  } catch (err) {
    log.dim(`  builtin domain catalog not loaded: ${(err as Error).message}`)
    return undefined
  }
}

/**
 * Probe an HTTP endpoint. Any HTTP response (even 4xx/5xx) counts as
 * "running" — we only care that a server is listening on the port and
 * speaking HTTP.
 */
export async function probeHttp(url: string, timeoutMs = 1_500): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, method: 'GET' })
    // Drain body to release sockets promptly.
    await res.text().catch(() => {})
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
