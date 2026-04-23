import type { Kernel } from '@astrale-os/kernel-toolkit'

import { clearGraph, deleteGraph, listGraphs } from '@astrale-os/kernel-adapters/falkordb'
import { KernelClient, type FnMap } from '@astrale-os/kernel-client'
import chalk from 'chalk'
import { unlink } from 'node:fs/promises'

import { resolveCredential } from '../kernel/auth'
import { readConfig } from '../lib/config'
import { composeDown, composeUp, isManagerRunning, waitManagerHealthy } from '../lib/docker'
import { formatElapsed } from '../lib/format'
import { getActive, resolveInstanceId } from '../lib/instance'
import { log, spinner } from '../lib/log'
import { startManager, detectManagerState, removeManagerPid } from '../lib/manager-state'
import {
  COMPOSE_PATH,
  INSTANCES_PATH,
  JOURNAL_PATH,
  MANAGER_PID_PATH,
  UI_PID_PATH,
} from '../lib/paths'
import { stopCommand } from './stop'

type ResetOptions = {
  instance?: string
  yes?: boolean
  hard?: boolean
  hostMode?: boolean
}

export async function resetCommand(opts: ResetOptions): Promise<void> {
  if (opts.hard) {
    const config = await readConfig()
    return resetHard(config, opts)
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

  const client = new KernelClient<FnMap>({ url, requestTimeout: 30_000 })

  try {
    // List sub-instances to warn user
    const instances = (await client.call(
      '/manager.astrale.ai/class.KernelInstance/list',
      {},
      credential,
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
            credential,
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

  const client = new KernelClient<FnMap>({ url, requestTimeout: 30_000 })
  let spin: ReturnType<typeof spinner> | null = null

  try {
    const instances = (await client.call(
      '/manager.astrale.ai/class.KernelInstance/list',
      {},
      credential,
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
        credential,
      )
    }

    await client.call(
      '/manager.astrale.ai/class.KernelInstance/reboot',
      { id: targetId, clear: true },
      credential,
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

async function resetHard(
  config: Awaited<ReturnType<typeof readConfig>>,
  opts: ResetOptions,
): Promise<void> {
  const dockerMode = !opts.hostMode && (await isManagerRunning(COMPOSE_PATH).catch(() => false))
  if (dockerMode) {
    await resetHardDocker(config, opts)
  } else {
    await resetHardHost(config, opts)
  }
}

async function resetHardDocker(
  config: Awaited<ReturnType<typeof readConfig>>,
  opts: ResetOptions,
): Promise<void> {
  if (!opts.yes) {
    process.stdout.write(
      chalk.red(
        'This will tear down the compose stack, DELETE all FalkorDB graphs (volume), and clear local state. Continue? [y/N] ',
      ),
    )
    const answer = await readLine()
    if (answer.toLowerCase() !== 'y') {
      log.info('Aborted')
      process.exit(0)
    }
  }

  const startTime = performance.now()

  // Tear down containers + volumes. `-v` drops the falkordb data volume.
  const s1 = spinner('Stopping stack + removing volumes...')
  try {
    await composeDown({ volumes: true }, COMPOSE_PATH)
    s1.succeed('Stack down, volumes removed')
  } catch (e) {
    s1.fail('Compose down failed')
    throw e
  }

  // Clear CLI-side state that doesn't live in falkordb.
  const stateFiles = [INSTANCES_PATH, MANAGER_PID_PATH, UI_PID_PATH, JOURNAL_PATH]
  await Promise.all(stateFiles.map((file) => unlink(file).catch(() => {})))
  log.dim('  Local state files cleared')

  // Bring the stack back up — fresh falkordb + manager.
  const s2 = spinner('Restarting stack...')
  try {
    await composeUp(COMPOSE_PATH)
    await waitManagerHealthy(`http://localhost:${config.managerPort}/mngt/`)
    s2.succeed('Stack is up')
  } catch (e) {
    s2.fail('Stack restart failed')
    throw e
  }

  const elapsed = performance.now() - startTime
  log.success(`Hard reset complete ${chalk.dim(`in ${formatElapsed(elapsed)}`)}`)
  log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)
  log.info(`Playground UI on http://localhost:${config.managerPort}/`)
}

async function resetHardHost(
  config: Awaited<ReturnType<typeof readConfig>>,
  opts: ResetOptions,
): Promise<void> {
  if (!opts.yes) {
    process.stdout.write(
      chalk.red('This will DELETE all FalkorDB graphs and reset all local state. Continue? [y/N] '),
    )
    const answer = await readLine()
    if (answer.toLowerCase() !== 'y') {
      log.info('Aborted')
      process.exit(0)
    }
  }

  const startTime = performance.now()

  // Stop manager & UI if running
  const state = await detectManagerState(config)
  if (state.running) {
    const spin = spinner('Stopping manager...')
    await stopCommand({ hostMode: true })
    spin.succeed('Manager stopped')
  }

  try {
    const { stopUI } = await import('../lib/ui')
    stopUI()
  } catch {
    // UI not running
  }

  // Delete all FalkorDB graphs
  try {
    const graphs = await listGraphs({ port: config.falkorPort })
    if (graphs.length > 0) {
      const spin = spinner(`Deleting ${graphs.length} graph(s)...`)
      await Promise.all(
        graphs.map((graphName) => deleteGraph({ graphName, port: config.falkorPort })),
      )
      spin.succeed(`Deleted ${graphs.length} graph(s): ${graphs.join(', ')}`)
    } else {
      log.info('No graphs to delete')
    }
  } catch (error) {
    log.error(`Failed to delete graphs: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  const stateFiles = [INSTANCES_PATH, MANAGER_PID_PATH, UI_PID_PATH, JOURNAL_PATH]
  await Promise.all(stateFiles.map((file) => unlink(file).catch(() => {})))
  log.dim('  Local state files cleared')

  // Restart manager + UI
  const spin = spinner('Restarting manager...')
  const managerSession = await startManager(config)
  spin.succeed('Manager restarted')

  const elapsed = performance.now() - startTime
  log.success(`Hard reset complete ${chalk.dim(`in ${formatElapsed(elapsed)}`)}`)

  log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)
  log.info(`Playground UI on http://localhost:${config.managerPort}/`)
  log.info('Press Ctrl+C to stop')

  const cleanup = async () => {
    await managerSession.close()
    await removeManagerPid()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
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
