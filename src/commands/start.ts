import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'

import { readConfig } from '../lib/config'
import {
  assertDockerAvailable,
  assertWorkspaceInstalled,
  buildManagerImage,
  composeUp,
  isManagerRunning,
  managerImageExists,
  managerImageTag,
  waitManagerHealthy,
  writeComposeFile,
} from '../lib/docker'
import { fatal, log, spinner } from '../lib/log'
import { startManager, detectManagerState, removeManagerPid } from '../lib/manager-state'
import { COMPOSE_PATH, LOGS_DIR } from '../lib/paths'
import { spawnUis, stopUis } from '../lib/ui'

type StartOptions = {
  foreground?: boolean
  hostMode?: boolean
  noUi?: boolean
}

/**
 * Two run modes:
 *
 *   - **docker-mode** (default) — manager + playground run as services in
 *     the `~/.astrale/docker-compose.yml` stack. The playground is a
 *     TanStack Start server with Vite HMR, reading credentials straight
 *     from the shared keys bind-mount. The main GUI is launched separately
 *     (`pnpm -C gui dev`).
 *
 *   - **host-mode** (`--host-mode`) — the manager runs as a bun process on
 *     the host, tracked via a PID file. The playground must be started
 *     separately (`pnpm -C cli/playground dev`); the GUI likewise
 *     (`pnpm -C gui dev`). Both read keys from `~/.astrale/keys/` directly.
 */
export async function startCommand(opts: StartOptions): Promise<void> {
  const config = await readConfig()

  if (opts.hostMode === true) {
    await startHostMode(config, opts)
    return
  }

  try {
    await startDockerMode(config, opts)
  } catch (e) {
    fatal(e)
  }
}

async function startDockerMode(
  config: Awaited<ReturnType<typeof readConfig>>,
  opts: StartOptions,
): Promise<void> {
  await assertDockerAvailable()
  await assertWorkspaceInstalled()

  const [running, imageExists] = await Promise.all([
    isManagerRunning(COMPOSE_PATH),
    managerImageExists(),
  ])

  if (running) {
    log.warn(`Manager container already running on port ${config.managerPort}`)
    log.dim('  Run `astrale stop` first, or `astrale restart` to reload.')
    return
  }

  // Always invoke `docker build` so manifest/lockfile changes are picked up.
  // The Dockerfile copies every package.json + pnpm-lock.yaml before
  // `pnpm install`, so a no-op rebuild is a full cache hit (~2-5s). When
  // the image already exists we run quietly — Docker's layer cache decides
  // whether anything actually rebuilds. First-time builds stream progress
  // since the deps install can take 30-60s.
  const tag = await managerImageTag()
  const buildSpinner = spinner(
    imageExists
      ? `Refreshing manager image astrale-os/manager:${tag}...`
      : `Building manager image astrale-os/manager:${tag}...`,
  )
  try {
    await buildManagerImage({ quiet: imageExists })
    buildSpinner.succeed(
      imageExists ? `Manager image up to date` : `Built astrale-os/manager:${tag}`,
    )
  } catch (e) {
    buildSpinner.fail('Manager image build failed')
    throw e
  }

  await writeComposeFile(COMPOSE_PATH, {
    falkorPort: config.falkorPort,
    managerPort: config.managerPort,
    graphName: config.graphName,
  })

  const s = spinner('Starting stack (falkordb + manager + playground)...')
  try {
    await composeUp(COMPOSE_PATH)
    await waitManagerHealthy(`http://localhost:${config.managerPort}/mngt/`)
    s.succeed('Stack is up')
  } catch (e) {
    s.fail('Stack failed to start')
    throw e
  }

  // Auto-spawn the playground dev server on the host unless the user opts
  // out with --no-ui. It runs detached; its PID is recorded in
  // ~/.astrale/ui.pids.json and killed by `astrale stop`.
  if (opts.noUi !== true) {
    await stopUis({ silent: true }) // cleanup stale PIDs from a previous run
    await spawnUis()
  }

  log.success('Astrale started')
  if (opts.noUi) {
    log.dim(`  Manager:    http://localhost:${config.managerPort}/mngt (API)`)
    log.dim('  Playground: run `pnpm -C cli/playground dev`')
  } else {
    log.info(`  Playground: http://localhost:3200`)
    log.dim(`  Manager:    http://localhost:${config.managerPort}/mngt (API)`)
    log.dim(`  UI logs:    ${LOGS_DIR}/playground.stdout.log`)
  }
  log.dim('  GUI:        run `pnpm -C gui dev` separately (http://localhost:3400)')
  log.dim(`  Logs:    astrale server logs -f`)
  log.dim('  Stop:    astrale stop')
}

async function startHostMode(
  config: Awaited<ReturnType<typeof readConfig>>,
  opts: StartOptions,
): Promise<void> {
  const existing = await detectManagerState(config)
  if (existing.running) {
    log.warn(
      `Manager is already running on port ${config.managerPort}${
        existing.pid !== undefined ? ` (PID ${existing.pid})` : ''
      }`,
    )
    log.dim('  Run `astrale stop --host-mode` first if you want to restart.')
    return
  }

  if (opts.foreground) {
    const manager = await startManager(config)
    log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)

    if (opts.noUi !== true) {
      await stopUis({ silent: true })
      await spawnUis()
      log.info(`  Playground: http://localhost:3200`)
    } else {
      log.dim('  Playground: run `pnpm -C cli/playground dev`')
    }
    log.dim('  GUI:        run `pnpm -C gui dev` separately (http://localhost:3400)')

    let shuttingDown = false
    const cleanup = async () => {
      if (shuttingDown) return
      shuttingDown = true
      await stopUis({ silent: true })
      await manager.close()
      await removeManagerPid()
      process.exit(0)
    }
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
    return
  }

  await mkdir(LOGS_DIR, { recursive: true })

  const managerOut = openSync(join(LOGS_DIR, 'manager.stdout.log'), 'a')
  const managerErr = openSync(join(LOGS_DIR, 'manager.stderr.log'), 'a')

  const entry = Bun.main || process.argv[1]

  const managerProc = Bun.spawn(['bun', 'run', entry, 'start', '--foreground', '--host-mode'], {
    stdout: managerOut,
    stderr: managerErr,
    stdin: 'ignore',
  })

  closeSync(managerOut)
  closeSync(managerErr)
  managerProc.unref()

  await new Promise((r) => setTimeout(r, 2_000))

  try {
    process.kill(managerProc.pid, 0)
  } catch {
    log.error('Manager failed to start. Check logs:')
    log.dim(`  ${join(LOGS_DIR, 'manager.stderr.log')}`)
    process.exit(1)
  }

  const state = await detectManagerState(config)
  if (!state.running) {
    // Probe FalkorDB before pointing the user at manager logs — a
    // FalkorDB-unreachable error otherwise looks like a manager crash
    // (META_TRACE #20). The most common cause is `falkorHost: "localhost"`
    // resolving to ::1 on macOS while OrbStack publishes IPv4-only.
    const falkorReachable = await probeTcp(config.falkorHost, config.falkorPort, 1000)
    if (!falkorReachable) {
      log.error(
        `Manager started but FalkorDB at ${config.falkorHost}:${config.falkorPort} is unreachable.`,
      )
      log.dim(
        `  On macOS, "localhost" may resolve to ::1 first; set falkorHost to "127.0.0.1" in ~/.astrale/config.json.`,
      )
      log.dim(`  Manager logs: ${join(LOGS_DIR, 'manager.stderr.log')}`)
      process.exit(1)
    }
    log.error('Manager process started but is not responding on the HTTP port. Check logs:')
    log.dim(`  ${join(LOGS_DIR, 'manager.stderr.log')}`)
    process.exit(1)
  }

  if (opts.noUi !== true) {
    await stopUis({ silent: true })
    await spawnUis()
  }

  log.success('Astrale started in background (host-mode)')
  if (opts.noUi) {
    log.dim(`  Manager:    http://localhost:${config.managerPort}/mngt (API)`)
    log.dim('  Playground: run `pnpm -C cli/playground dev`')
  } else {
    log.info(`  Playground: http://localhost:3200`)
    log.dim(`  Manager:    http://localhost:${config.managerPort}/mngt (API)`)
    log.dim(`  UI logs:    ${LOGS_DIR}/playground.stdout.log`)
  }
  log.dim('  GUI:        run `pnpm -C gui dev` separately (http://localhost:3400)')
  log.dim(`  PID:     ${managerProc.pid}`)
  log.dim(`  Logs:    ${LOGS_DIR}`)
  log.info('Run `astrale stop --host-mode` to stop')
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const settle = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}
