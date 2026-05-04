import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
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
 *   - **docker-mode** (default) — manager + playground + gui run as services
 *     in the `~/.astrale/docker-compose.yml` stack. Each UI is a TanStack
 *     Start server with Vite HMR, reading credentials straight from the
 *     shared keys bind-mount. No API token; no `/api/auth` endpoint.
 *
 *   - **host-mode** (`--host-mode`) — the manager runs as a bun process on
 *     the host, tracked via a PID file. UIs must be started separately
 *     (e.g. `pnpm -C cli/playground dev`, `pnpm -C cli/gui dev`) — they read
 *     keys from `~/.astrale/keys/` directly.
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

  const s = spinner('Starting stack (falkordb + manager + playground + gui)...')
  try {
    await composeUp(COMPOSE_PATH)
    await waitManagerHealthy(`http://localhost:${config.managerPort}/mngt/`)
    s.succeed('Stack is up')
  } catch (e) {
    s.fail('Stack failed to start')
    throw e
  }

  // Auto-spawn the two UI dev servers on the host unless the user opts out
  // with --no-ui. They run detached; their PIDs are recorded in
  // ~/.astrale/ui.pids.json and killed by `astrale stop`.
  if (opts.noUi !== true) {
    await stopUis({ silent: true }) // cleanup stale PIDs from a previous run
    await spawnUis()
  }

  log.success('Astrale started')
  if (opts.noUi) {
    log.dim(`  Manager: http://localhost:${config.managerPort}/mngt (API)`)
    log.dim('  UIs:     run `pnpm -C cli/playground dev` + `pnpm -C cli/gui dev`')
  } else {
    log.info(`  Playground: http://localhost:3200`)
    log.dim(`  Manager:    http://localhost:${config.managerPort}/mngt (API)`)
    log.dim(`  UI logs: ${LOGS_DIR}/{playground,gui}.stdout.log`)
  }
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
      log.dim('  UIs: run `pnpm -C cli/playground dev` + `pnpm -C cli/gui dev`')
    }

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
    log.dim(`  Manager: http://localhost:${config.managerPort}/mngt (API)`)
    log.dim('  UIs:     run `pnpm -C cli/playground dev` + `pnpm -C cli/gui dev`')
  } else {
    log.info(`  Playground: http://localhost:3200`)
    log.dim(`  Manager:    http://localhost:${config.managerPort}/mngt (API)`)
    log.dim(`  UI logs: ${LOGS_DIR}/{playground,gui}.stdout.log`)
  }
  log.dim(`  PID:     ${managerProc.pid}`)
  log.dim(`  Logs:    ${LOGS_DIR}`)
  log.info('Run `astrale stop --host-mode` to stop')
}
