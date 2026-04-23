#!/usr/bin/env bun
/**
 * Manager container entry point.
 *
 * Runs inside the `manager` service of `~/.astrale/docker-compose.yml`.
 * Derives an `AstraleConfig` from env vars (host config.json is not
 * bind-mounted), then reuses the same `startManager()` the host-mode
 * `astrale start --host-mode` flow uses. Docker tracks the lifecycle, so
 * `ASTRALE_IN_CONTAINER=1` makes `startManager()` skip the host PID file.
 *
 * Required env vars (set by `cli/src/lib/docker.ts` at write-compose):
 *   ASTRALE_MANAGER_PORT   — port the manager listens on inside container
 *   ASTRALE_FALKOR_HOST    — compose network alias for FalkorDB
 *   ASTRALE_FALKOR_PORT    — FalkorDB port (6379 by default)
 *   ASTRALE_PUBLIC_URL     — how the manager is reachable from the host
 *   ASTRALE_GRAPH_NAME     — manager's own FalkorDB graph name
 */
import type { AstraleConfig } from './lib/config'

import { readPositiveIntEnv } from './lib/env'
import { log } from './lib/log'
import { startManager } from './lib/manager-state'

process.env.ASTRALE_IN_CONTAINER = '1'

const managerPort = readPositiveIntEnv('ASTRALE_MANAGER_PORT', 4400)
const falkorPort = readPositiveIntEnv('ASTRALE_FALKOR_PORT', 6379)
const falkorHost = process.env.ASTRALE_FALKOR_HOST ?? 'falkordb'
const publicUrl = process.env.ASTRALE_PUBLIC_URL ?? `http://localhost:${managerPort}`
const graphName = process.env.ASTRALE_GRAPH_NAME ?? 'astrale-manager'

const config: AstraleConfig = {
  managerPort,
  falkorPort,
  falkorHost,
  uiPort: readPositiveIntEnv('ASTRALE_UI_PORT', 4300),
  graphName,
  issuer: `${publicUrl}/mngt`,
}

const manager = await startManager(config)
log.info(
  `[manager] listening on :${managerPort} (falkor=${falkorHost}:${falkorPort}, graph=${graphName})`,
)

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info(`[manager] received ${signal}, shutting down…`)
  try {
    await manager.close()
  } finally {
    process.exit(0)
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
