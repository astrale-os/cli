import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { API_TOKEN_ENV, API_TOKEN_PARAM, generateApiToken } from '../lib/api-token'
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

type StartOptions = {
  foreground?: boolean
  uiDev?: boolean
  hostMode?: boolean
}

/**
 * Two run modes:
 *
 *   - **docker-mode** (default) — the manager runs as a container in the
 *     `~/.astrale/docker-compose.yml` stack. Source is bind-mounted from
 *     the workspace; `astrale restart` reloads it.
 *
 *   - **host-mode** (`--host-mode` or implied by `--ui-dev`) — the manager
 *     runs as a bun process on the host, tracked via a PID file. Needed
 *     for `--ui-dev` (Vite HMR doesn't cross the container boundary).
 */
export async function startCommand(opts: StartOptions): Promise<void> {
  const config = await readConfig()

  // `--ui-dev` requires host-mode for Vite HMR to work. Auto-enable it.
  const useHostMode = opts.hostMode === true || opts.uiDev === true

  if (useHostMode) {
    await startHostMode(config, opts)
    return
  }

  try {
    await startDockerMode(config)
  } catch (e) {
    fatal(e)
  }
}

async function startDockerMode(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
  await assertDockerAvailable()
  await assertWorkspaceInstalled()

  // `isManagerRunning` and `managerImageExists` are independent docker
  // calls — running them in parallel cuts one sequential round-trip.
  const [running, imageExists] = await Promise.all([
    isManagerRunning(COMPOSE_PATH),
    managerImageExists(),
  ])

  if (running) {
    log.warn(`Manager container already running on port ${config.managerPort}`)
    log.dim('  Run `astrale stop` first, or `astrale restart` to reload.')
    return
  }

  if (!imageExists) {
    const tag = await managerImageTag()
    const s = spinner(`Building manager image astrale-os/manager:${tag}...`)
    try {
      await buildManagerImage()
      s.succeed(`Built astrale-os/manager:${tag}`)
    } catch (e) {
      s.fail('Manager image build failed')
      throw e
    }
  }

  // Fresh API token for this launch — embedded in the compose env so the
  // manager container picks it up, surfaced to the user as `?token=...`.
  const apiToken = generateApiToken()

  // Compose file present + up to date?
  await writeComposeFile(COMPOSE_PATH, {
    falkorPort: config.falkorPort,
    managerPort: config.managerPort,
    graphName: config.graphName,
    apiToken,
  })

  const s = spinner('Starting stack (falkordb + manager)...')
  try {
    await composeUp(COMPOSE_PATH)
    await waitManagerHealthy(`http://localhost:${config.managerPort}/mngt/`)
    s.succeed('Stack is up')
  } catch (e) {
    s.fail('Stack failed to start')
    throw e
  }

  const uiUrl = `http://localhost:${config.managerPort}/?${API_TOKEN_PARAM}=${apiToken}`
  log.success('Astrale started')
  log.dim(`  Manager: http://localhost:${config.managerPort}/mngt`)
  log.info(`  UI:      ${uiUrl}`)
  log.dim('  (token is regenerated on every start; bookmark above to authenticate)')
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
    // Inherit token from the parent (background launcher) when present —
    // otherwise generate one so the foreground-only flow also gets a URL.
    if (!process.env[API_TOKEN_ENV]) {
      process.env[API_TOKEN_ENV] = generateApiToken()
    }
    const apiToken = process.env[API_TOKEN_ENV]!

    const manager = await startManager(config)
    log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)

    let stopUIFn: (() => void) | undefined
    if (opts.uiDev) {
      const { startUIDev, stopUI } = await import('../lib/ui')
      startUIDev(config)
      stopUIFn = stopUI
      log.info(
        `Playground UI (dev) on http://localhost:${config.uiPort}/?${API_TOKEN_PARAM}=${apiToken}`,
      )
    } else {
      log.info(
        `Playground UI on http://localhost:${config.managerPort}/?${API_TOKEN_PARAM}=${apiToken}`,
      )
    }

    let shuttingDown = false
    const cleanup = async () => {
      if (shuttingDown) return
      shuttingDown = true
      stopUIFn?.()
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

  // Generate the token in the parent so it can be printed even though the
  // child runs detached. Inherited via env.
  const apiToken = generateApiToken()

  const childArgs = ['bun', 'run', entry, 'start', '--foreground', '--host-mode']
  if (opts.uiDev) childArgs.push('--ui-dev')
  const managerProc = Bun.spawn(childArgs, {
    stdout: managerOut,
    stderr: managerErr,
    stdin: 'ignore',
    env: { ...process.env, [API_TOKEN_ENV]: apiToken },
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

  log.success('Astrale started in background (host-mode)')
  log.dim(`  Manager: http://localhost:${config.managerPort}/mngt`)
  const uiHost = opts.uiDev ? config.uiPort : config.managerPort
  const uiLabel = opts.uiDev ? 'UI dev' : 'UI    '
  log.info(`  ${uiLabel}: http://localhost:${uiHost}/?${API_TOKEN_PARAM}=${apiToken}`)
  log.dim('  (token is regenerated on every start; bookmark above to authenticate)')
  log.dim(`  PID:     ${managerProc.pid}`)
  log.dim(`  Logs:    ${LOGS_DIR}`)
  log.info('Run `astrale stop --host-mode` to stop')
  log.warn('Kernel source changes require `astrale restart` — the manager caches modules on boot')
}
