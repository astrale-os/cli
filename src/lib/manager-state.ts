import type { Kernel } from '@astrale-os/kernel-toolkit'

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { AstraleConfig } from './config'

import { resolveAuth } from './keys'
import { INSTANCES_PATH, KEYS_DIR, MANAGER_PID_PATH } from './paths'

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
 * Start the Astrale manager kernel and bind HTTP.
 *
 * Composition:
 *   - `storage: falkordb(...)` — manager's own graph (holds manager domain + child registry).
 *   - `manager: inProcessManager(...)` — enables multi-instance mode. The driver
 *     installs `ManagerSchema` (`KernelInstance/*`) into the manager graph and
 *     mounts the multiplex routes (`/mngt` for manager dispatch, `/:id/` for
 *     child direct access, `/mgt/:id/` for admin gateway, per-instance JWKS).
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
  const { Kernel, falkordb, inProcessManager, node, DiskInstanceStore } =
    await import('@astrale-os/kernel-toolkit')
  const { deleteGraph } = await import('@astrale-os/kernel-adapters/falkordb')

  const store = new DiskInstanceStore(dirname(INSTANCES_PATH))

  const kernel = new Kernel({
    mode: 'manager',
    publicUrl: config.issuer,
    id: 'manager',
    auth,
    drivers: {
      storage: falkordb({
        graphName: config.graphName,
        port: config.falkorPort,
      }),
      transports: [node()],
      manager: inProcessManager({
        store,
        async spawn(_parent, cfg) {
          const child = new Kernel({
            publicUrl: cfg.issuer ?? `http://localhost:${config.managerPort}/${cfg.id}`,
            id: cfg.id,
            drivers: {
              storage: falkordb({
                graphName: cfg.graphName,
                host: cfg.host,
                port: cfg.port,
              }),
            },
          })
          await child.boot()
          return {
            kernel: child,
            disposer: async () => {
              await deleteGraph({
                graphName: cfg.graphName,
                host: cfg.host,
                port: cfg.port,
              })
            },
          }
        },
      }),
    },
  })
  await kernel.listen({ port: config.managerPort })
  await writeManagerPid(process.pid)
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
