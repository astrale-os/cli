import { readConfig } from '../lib/config'
import { composeRestart, isManagerRunning, waitManagerHealthy } from '../lib/docker'
import { fatal, log, spinner } from '../lib/log'
import { COMPOSE_PATH } from '../lib/paths'
import { startCommand } from './start'
import { stopCommand } from './stop'

type RestartOptions = {
  foreground?: boolean
  hostMode?: boolean
}

export async function restartCommand(opts: RestartOptions): Promise<void> {
  if (opts.hostMode === true) {
    log.info('Stopping manager…')
    await stopCommand({ hostMode: true })
    await new Promise((r) => setTimeout(r, 500))
    log.info('Starting manager…')
    await startCommand(opts)
    return
  }

  try {
    if (!(await isManagerRunning(COMPOSE_PATH))) {
      await startCommand(opts)
      return
    }
    const config = await readConfig()
    const s = spinner('Restarting manager container…')
    try {
      await composeRestart('manager', COMPOSE_PATH)
      await waitManagerHealthy(`http://localhost:${config.managerPort}/mngt/`)
      s.succeed('Manager restarted')
    } catch (e) {
      s.fail('Manager restart failed')
      throw e
    }

    log.dim(`  Manager:    http://localhost:${config.managerPort}/mngt (API)`)
    log.info(`  Playground: http://localhost:3200`)
    log.dim('  GUI:        run `pnpm -C gui dev` separately (http://localhost:3400)')
    log.dim(`  Logs:    astrale server logs -f`)
    log.dim('  Stop:    astrale stop')
  } catch (e) {
    fatal(e)
  }
}
