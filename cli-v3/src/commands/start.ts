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
    const auth = await resolveAuth(KEYS_DIR, {
      issuer: config.issuer,
      subject: 'manager',
    })

    const { ManagerSession } = await import('@astrale-os/kernel-toolkit/manager')

    const manager = await ManagerSession.boot({
      graphName: config.graphName,
      falkorPort: config.falkorPort,
      auth,
    })

    manager.serve({ port: config.managerPort })

    log.info(`Manager running on ws://localhost:${config.managerPort}/mngt/ws`)

    const { startUI, stopUI } = await import('../lib/ui')
    startUI(config)
    log.info(`Playground UI on http://localhost:${config.uiPort}`)

    const cleanup = async () => {
      stopUI()
      await manager.close()
      process.exit(0)
    }
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  } else {
    await mkdir(LOGS_DIR, { recursive: true })

    const managerOut = openSync(join(LOGS_DIR, 'manager.stdout.log'), 'a')
    const managerErr = openSync(join(LOGS_DIR, 'manager.stderr.log'), 'a')

    const managerProc = Bun.spawn(['bun', 'run', process.argv[1], 'start', '--foreground'], {
      stdout: managerOut,
      stderr: managerErr,
      env: { ...process.env },
    })

    await writeFile(MANAGER_PID_PATH, String(managerProc.pid))
    await new Promise((r) => setTimeout(r, 2000))

    try {
      process.kill(managerProc.pid, 0)
    } catch {
      log.error('Manager failed to start. Check logs:')
      log.dim(`  ${join(LOGS_DIR, 'manager.stderr.log')}`)
      process.exit(1)
    }

    log.success('Astrale started in background')
    log.dim(`  Manager: ws://localhost:${config.managerPort}/mngt/ws`)
    log.dim(`  UI:      http://localhost:${config.uiPort}`)
    log.dim(`  PIDs:    manager=${managerProc.pid}`)
    log.dim(`  Logs:    ${LOGS_DIR}`)
    log.info('Run `astrale stop` to stop')
  }
}
