import { readConfig } from '../lib/config'
import { resolveAuth } from '../lib/keys'
import { KEYS_DIR, LOGS_DIR, MANAGER_PID_PATH } from '../lib/paths'
import { log } from '../lib/log'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { openSync } from 'node:fs'

export async function startCommand(opts: { foreground?: boolean }): Promise<void> {
  const config = await readConfig()

  if (opts.foreground) {
    // Foreground mode — blocks terminal, used by daemon or init
    const auth = await resolveAuth(KEYS_DIR, {
      issuer: config.issuer,
      subject: 'manager',
    })

    const { startManager } = await import('@astrale-os/kernel-toolkit/manager')

    await startManager({
      port: config.managerPort,
      graphName: config.graphName,
      falkorPort: config.falkorPort,
      auth,
    })

    log.info(`Manager running on ws://localhost:${config.managerPort}/ws`)

    // Start UI in foreground too
    const { startUI, stopUI } = await import('../lib/ui')
    startUI(config)
    log.info(`Playground UI on http://localhost:${config.uiPort}`)

    const cleanup = () => {
      stopUI()
      process.exit(0)
    }
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  } else {
    // Background mode — spawn detached processes, write PID files
    await mkdir(LOGS_DIR, { recursive: true })

    const managerOut = openSync(join(LOGS_DIR, 'manager.stdout.log'), 'a')
    const managerErr = openSync(join(LOGS_DIR, 'manager.stderr.log'), 'a')

    // Spawn manager as detached process using the same entry point
    const managerProc = Bun.spawn(['bun', 'run', process.argv[1], 'start', '--foreground'], {
      stdout: managerOut,
      stderr: managerErr,
      env: { ...process.env },
    })

    // Unref so parent can exit — Bun.spawn doesn't have unref/detach,
    // so we write PID and let the process run
    await writeFile(MANAGER_PID_PATH, String(managerProc.pid))

    // Give it a moment to boot
    await new Promise((r) => setTimeout(r, 2000))

    // Check it's still alive
    try {
      process.kill(managerProc.pid, 0) // signal 0 = check alive
    } catch {
      log.error('Manager failed to start. Check logs:')
      log.dim(`  ${join(LOGS_DIR, 'manager.stderr.log')}`)
      process.exit(1)
    }

    log.success('Astrale started in background')
    log.dim(`  Manager: ws://localhost:${config.managerPort}/ws`)
    log.dim(`  UI:      http://localhost:${config.uiPort}`)
    log.dim(`  PIDs:    manager=${managerProc.pid}`)
    log.dim(`  Logs:    ${LOGS_DIR}`)
    log.info('Run `astrale stop` to stop')
  }
}
