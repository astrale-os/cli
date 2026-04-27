import type { Kernel } from '@astrale-os/kernel-toolkit'

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AstraleConfig } from './config'

import { isInContainer } from './env'
import { resolveAuth } from './keys'
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
export async function startManager(config: AstraleConfig): Promise<Kernel> {
  const auth = await resolveAuth(KEYS_DIR, {
    issuer: config.issuer,
    subject: 'manager',
  })
  const { Kernel, falkordb, inProcessManager, node, ndjsonJournal } =
    await import('@astrale-os/kernel-toolkit')
  const { deleteGraph } = await import('@astrale-os/kernel-adapters/falkordb')

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
            disposer: async () => {
              // Use the manager's own falkor config — the child's stored
              // `host` may be the CLI's default `localhost`, which doesn't
              // resolve to FalkorDB when the manager runs in a container
              // (compose service name is `falkordb`).
              await deleteGraph({
                graphName: cfg.graphName,
                host: config.falkorHost,
                port: config.falkorPort,
              })
            },
          }
        },
      }),
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
