import { openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readConfig } from '../lib/config'
import { log } from '../lib/log'
import { bootManagerSession, detectManagerState, removeManagerPid } from '../lib/manager-state'
import { LOGS_DIR } from '../lib/paths'

export async function startCommand(opts: { foreground?: boolean }): Promise<void> {
  const config = await readConfig()

  // Refuse to start a second manager if one is already live.
  const existing = await detectManagerState(config)
  if (existing.running) {
    log.warn(
      `Manager is already running on port ${config.managerPort}${
        existing.pid !== undefined ? ` (PID ${existing.pid})` : ''
      }`,
    )
    log.dim('  Run `astrale stop` first if you want to restart.')
    return
  }

  if (opts.foreground) {
    const manager = await bootManagerSession(config)
    manager.serve()
    log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)

    const { startUI, stopUI } = await import('../lib/ui')
    startUI(config)
    log.info(`Playground UI on http://localhost:${config.uiPort}`)

    let shuttingDown = false
    const cleanup = async () => {
      if (shuttingDown) return
      shuttingDown = true
      stopUI()
      await manager.close()
      await removeManagerPid()
      process.exit(0)
    }
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  } else {
    await mkdir(LOGS_DIR, { recursive: true })

    const managerOut = openSync(join(LOGS_DIR, 'manager.stdout.log'), 'a')
    const managerErr = openSync(join(LOGS_DIR, 'manager.stderr.log'), 'a')

    // Use Bun.main — the actual entry point resolved by the runtime — rather
    // than process.argv[1], which may be a shim path after a global install
    // that `bun run` can't execute directly.
    const entry = Bun.main || process.argv[1]

    const managerProc = Bun.spawn(['bun', 'run', entry, 'start', '--foreground'], {
      stdout: managerOut,
      stderr: managerErr,
      stdin: 'ignore',
      env: { ...process.env },
    })

    // Wait briefly for the child to either become ready or die.
    await new Promise((r) => setTimeout(r, 2_000))

    try {
      process.kill(managerProc.pid, 0)
    } catch {
      log.error('Manager failed to start. Check logs:')
      log.dim(`  ${join(LOGS_DIR, 'manager.stderr.log')}`)
      process.exit(1)
    }

    // Confirm the manager is actually serving, not just alive.
    const state = await detectManagerState(config)
    if (!state.running) {
      log.error('Manager process started but is not responding on the HTTP port. Check logs:')
      log.dim(`  ${join(LOGS_DIR, 'manager.stderr.log')}`)
      process.exit(1)
    }

    log.success('Astrale started in background')
    log.dim(`  Manager: http://localhost:${config.managerPort}/mngt`)
    log.dim(`  UI:      http://localhost:${config.uiPort}`)
    log.dim(`  PID:     ${managerProc.pid}`)
    log.dim(`  Logs:    ${LOGS_DIR}`)
    log.info('Run `astrale stop` to stop')
  }
}
