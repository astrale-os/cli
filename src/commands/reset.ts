import type { Kernel } from '@astrale-os/kernel-toolkit'

import { clearGraph } from '@astrale-os/kernel-adapters/falkordb'
import { type FnMap } from '@astrale-os/kernel-client'
import { ClientSession } from '@astrale-os/kernel-client/session'
import chalk from 'chalk'
import { rm, rmdir } from 'node:fs/promises'

import { stopAllTunnels } from '../adapters/tunnel-cloudflared'
import { resolveCredential } from '../kernel/auth'
import { readConfig } from '../lib/config'
import { composeDown, forceRemoveContainer } from '../lib/docker'
import { formatElapsed } from '../lib/format'
import { getActive, resolveInstanceId } from '../lib/instance'
import { log, spinner } from '../lib/log'
import {
  detectManagerState,
  forceStopManager,
  removeManagerPid,
  startManager,
} from '../lib/manager-state'
import {
  ASTRALE_HOME,
  COMPOSE_PATH,
  CONFIG_PATH,
  DATA_DIR,
  DOMAINS_DIR,
  IDENTITIES_PATH,
  INSTANCES_PATH,
  KEYS_DIR,
  LOGS_DIR,
  MANAGER_CACHE_PATH,
  MANAGER_PID_PATH,
  TUNNELS_DIR,
  TUNNELS_PATH,
  UI_PID_PATH,
} from '../lib/paths'
import { stopUis } from '../lib/ui'
import { stopCommand } from './stop'

type ResetOptions = {
  instance?: string
  yes?: boolean
  hard?: boolean
  hostMode?: boolean
}

export async function resetCommand(opts: ResetOptions): Promise<void> {
  if (opts.hard) {
    return resetHard(opts)
  }
  const config = await readConfig()
  const active = await getActive(config)
  const targetName = opts.instance ?? active.name

  // `entry.url`/`entry.issuer` are no longer persisted for local-children
  // — branch on `kind` instead.
  if (targetName === 'manager' || active.kind === 'manager') {
    return resetManager(config, opts)
  }

  if (active.kind === 'bookmark' && !opts.instance) {
    log.error(`Cannot reset remote instance "${active.name}"`)
    log.dim('  Remote instances must be reset from their host machine')
    process.exit(1)
  }

  return resetSubInstance(config, opts)
}

// ── Manager reset ──────────────────────────────────────────────

async function resetManager(
  config: Awaited<ReturnType<typeof readConfig>>,
  opts: ResetOptions,
): Promise<void> {
  const url = `http://localhost:${config.managerPort}/mngt`
  const credential = await resolveCredential({}, config)

  let managerSession: Kernel | null = null

  if (!(await detectManagerState(config)).running) {
    log.info('Manager not running, starting...')
    managerSession = await startManager(config)
  }

  const client = new ClientSession<FnMap>({
    default: url,
    identity: credential,
  })

  try {
    // List sub-instances to warn user
    const instances = (await client.call(
      '/manager.astrale.ai/class.KernelInstance/list',
      {},
      { timeout: 30_000 },
    )) as Array<{ id: string; status: string }>

    // Confirm
    if (!opts.yes) {
      const msg =
        instances.length > 0
          ? `This will reset the manager and delete all ${instances.length} registered sub-instance(s). Continue? [y/N] `
          : 'This will reset the manager and clear all its data. Continue? [y/N] '
      process.stdout.write(chalk.yellow(msg))
      const answer = await readLine()
      if (answer.toLowerCase() !== 'y') {
        log.info('Aborted')
        client.disconnect()
        if (managerSession) await managerSession.close()
        process.exit(0)
      }
    }

    const startTime = performance.now()

    if (instances.length > 0) {
      const spin = spinner(`Removing ${instances.length} instance(s)...`)
      await Promise.all(
        instances.map((instance) =>
          client.call(
            '/manager.astrale.ai/class.KernelInstance/delete',
            { id: instance.id },
          ),
        ),
      )
      spin.succeed(`Removed ${instances.length} instance(s)`)
    }

    client.disconnect()

    // Stop the manager
    const spin = spinner('Stopping manager...')
    if (managerSession) {
      await managerSession.close()
      managerSession = null
      await removeManagerPid()
    } else {
      await stopCommand()
    }
    spin.succeed('Manager stopped')

    // Clear the manager graph
    const spin2 = spinner('Clearing manager graph...')
    await clearGraph({ graphName: config.graphName, port: config.falkorPort })
    spin2.succeed('Manager graph cleared')

    // Restart the manager
    const spin3 = spinner('Restarting manager...')
    managerSession = await startManager(config)
    spin3.succeed('Manager restarted')

    const elapsed = performance.now() - startTime
    log.success(`Manager reset ${chalk.dim(`in ${formatElapsed(elapsed)}`)}`)

    const session = managerSession
    log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)
    log.info(`Playground UI on http://localhost:${config.managerPort}/`)
    log.info('Press Ctrl+C to stop')
    const cleanup = async () => {
      await session.close()
      await removeManagerPid()
      process.exit(0)
    }
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  } catch (error) {
    client.disconnect()
    if (managerSession) await managerSession.close().catch(() => {})
    log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// ── Sub-instance reset ─────────────────────────────────────────

async function resetSubInstance(
  config: Awaited<ReturnType<typeof readConfig>>,
  opts: ResetOptions,
): Promise<void> {
  const url = `http://localhost:${config.managerPort}/mngt`
  const credential = await resolveCredential({}, config)

  let managerSession: Kernel | null = null

  if (!(await detectManagerState(config)).running) {
    log.info('Manager not running, starting...')
    managerSession = await startManager(config)
  }

  const client = new ClientSession<FnMap>({
    default: url,
    identity: credential,
  })
  let spin: ReturnType<typeof spinner> | null = null

  try {
    const instances = (await client.call(
      '/manager.astrale.ai/class.KernelInstance/list',
      {},
      { timeout: 30_000 },
    )) as Array<{ id: string; status: string }>

    if (instances.length === 0) {
      log.error('No sub-kernel instances registered with the manager')
      log.dim('  To reset the manager itself, run: astrale reset -i manager')
      client.disconnect()
      if (managerSession) await managerSession.close()
      process.exit(1)
    }

    const targetId = (await resolveInstanceId(opts, config)) ?? instances[0].id

    const instance = instances.find((i) => i.id === targetId)
    if (!instance) {
      log.error(`Instance "${targetId}" not found`)
      log.dim(`  Available: ${instances.map((i) => i.id).join(', ')}`)
      client.disconnect()
      if (managerSession) await managerSession.close()
      process.exit(1)
    }

    // Confirm unless --yes
    if (!opts.yes) {
      const prompt = `This will clear all data in instance "${targetId}". Continue? [y/N] `
      process.stdout.write(chalk.yellow(prompt))
      const answer = await readLine()
      if (answer.toLowerCase() !== 'y') {
        log.info('Aborted')
        client.disconnect()
        if (managerSession) await managerSession.close()
        process.exit(0)
      }
    }

    spin = spinner(`Resetting instance "${targetId}"...`)
    const startTime = performance.now()

    // If instance is stopped, boot it first so reboot can proceed
    if (instance.status === 'stopped' || instance.status === 'registered') {
      await client.call(
        '/manager.astrale.ai/class.KernelInstance/boot',
        { id: targetId },
      )
    }

    await client.call(
      '/manager.astrale.ai/class.KernelInstance/reboot',
      { id: targetId, clear: true },
    )

    const elapsed = performance.now() - startTime
    spin.succeed(`Instance "${targetId}" reset ${chalk.dim(`in ${formatElapsed(elapsed)}`)}`)

    client.disconnect()

    if (managerSession) {
      const session = managerSession
      log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)
      log.info(`Playground UI on http://localhost:${config.managerPort}/`)
      log.info('Press Ctrl+C to stop')
      const cleanup = async () => {
        await session.close()
        await removeManagerPid()
        process.exit(0)
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    } else {
      process.exit(0)
    }
  } catch (error) {
    spin?.fail('Reset failed')
    client.disconnect()
    if (managerSession) await managerSession.close().catch(() => {})
    log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// ── Hard reset ────────────────────────────────────────────────

/**
 * Restore this machine to a fresh-install state. Stops every Astrale
 * process best-effort, removes the docker-compose stack and any stray
 * containers, then wipes every CLI-owned path under `$ASTRALE_HOME` —
 * including identities, keypairs, tunnel registrations, FalkorDB data,
 * domain dev state. Never depends on a live FalkorDB or running manager.
 *
 * Idempotent: running twice is fine. Does not auto-restart anything;
 * the user runs `astrale start` afterwards.
 */
async function resetHard(opts: ResetOptions): Promise<void> {
  if (!opts.yes) {
    process.stdout.write(
      chalk.red(
        'This will WIPE every Astrale state file on this machine — manager, child instances, identities, keypairs, tunnel registrations, FalkorDB data — as if this were a fresh install. Continue? [y/N] ',
      ),
    )
    const answer = await readLine()
    if (answer.toLowerCase() !== 'y') {
      log.info('Aborted')
      process.exit(0)
    }
  }

  const startTime = performance.now()
  const stopped: string[] = []
  const skipped: { path: string; reason: string }[] = []

  // ── Phase 1: stop everything best-effort ─────────────────
  // Order: kill children before parents so PID-file readers don't race.

  // Each step is wrapped: a failure inside any helper (missing binary on
  // PATH, spawn ENOENT, dead process race, etc.) must not abort the wipe.
  const tryStep = async (label: string, fn: () => Promise<boolean>): Promise<void> => {
    try {
      if (await fn()) stopped.push(label)
    } catch {
      /* swallow — phase 2 will still run */
    }
  }

  await tryStep('UIs', () => stopUis({ silent: true }))

  try {
    const n = await stopAllTunnels()
    if (n > 0) stopped.push(`${n} tunnel(s)`)
  } catch {
    /* swallow */
  }

  await tryStep('manager', () => forceStopManager())

  // Compose stack — covers both falkordb and manager containers in one shot.
  // If the compose file is missing or docker isn't installed, this is a no-op.
  await tryStep('compose stack', async () => {
    await composeDown(COMPOSE_PATH)
    return true
  })

  // Stray containers — anything started outside compose (e.g. a manually-run
  // FalkorDB) won't have been touched by composeDown.
  for (const name of ['astrale-falkordb-1', 'astrale-manager-1']) {
    await tryStep(`container ${name}`, () => forceRemoveContainer(name))
  }

  // ── Phase 2: wipe filesystem state ───────────────────────
  // Each entry here is a path the CLI itself writes; we don't touch
  // ~/.cloudflared/ or anything outside ASTRALE_HOME.
  const wipeTargets = [
    CONFIG_PATH,
    IDENTITIES_PATH,
    INSTANCES_PATH,
    TUNNELS_PATH,
    MANAGER_CACHE_PATH,
    MANAGER_PID_PATH,
    UI_PID_PATH,
    COMPOSE_PATH,
    KEYS_DIR,
    TUNNELS_DIR,
    LOGS_DIR,
    DATA_DIR,
    DOMAINS_DIR,
  ]

  let wiped = 0
  for (const target of wipeTargets) {
    try {
      await rm(target, { recursive: true, force: true })
      wiped++
    } catch (e) {
      skipped.push({ path: target, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  // Cosmetic: remove ASTRALE_HOME itself if now empty. Don't recreate —
  // the next CLI invocation lazy-inits whatever it needs. `rmdir` only
  // succeeds on empty dirs, so this is safe even if a wipe target above
  // failed and left children behind.
  await rmdir(ASTRALE_HOME).catch(() => {})

  // ── Phase 3: report ──────────────────────────────────────
  const elapsed = performance.now() - startTime
  log.success(`Hard reset complete ${chalk.dim(`in ${formatElapsed(elapsed)}`)}`)
  if (stopped.length > 0) log.info(`Stopped: ${stopped.join(', ')}`)
  log.info(`Wiped ${wiped} path(s) under ${ASTRALE_HOME}`)
  if (skipped.length > 0) {
    log.warn(`Skipped ${skipped.length} path(s):`)
    for (const s of skipped) log.dim(`  ${s.path}: ${s.reason}`)
  }
  log.dim(
    'Not touched: ~/.cloudflared (cloudflared account/credentials), Cloudflare DNS records, remote distribution domain workers',
  )
  log.info('Run `astrale start` to bootstrap a new manager.')
}

// ── Helpers ────────────────────────────────────────────────────

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.resume()
    process.stdin.on('data', (chunk) => {
      data += chunk
      if (data.includes('\n')) {
        process.stdin.pause()
        resolve(data.trim())
      }
    })
  })
}
