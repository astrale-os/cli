import { readConfig } from '../lib/config'
import { composeRestart, isManagerRunning, waitManagerHealthy } from '../lib/docker'
import { fatal, log, spinner } from '../lib/log'
import { COMPOSE_PATH } from '../lib/paths'
import { startCommand } from './start'
import { stopCommand } from './stop'

type RestartOptions = {
  foreground?: boolean
  uiDev?: boolean
  hostMode?: boolean
}

export async function restartCommand(opts: RestartOptions): Promise<void> {
  const useHostMode = opts.hostMode === true || opts.uiDev === true

  if (useHostMode) {
    log.info('Stopping manager…')
    await stopCommand({ hostMode: true })
    await new Promise((r) => setTimeout(r, 500))
    log.info('Starting manager…')
    await startCommand(opts)
    return
  }

  // Docker-mode: `docker compose restart manager` is the canonical way.
  // If the service isn't already running (first boot), fall back to
  // `startCommand` which does the full bring-up (build image + compose up).
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
  } catch (e) {
    fatal(e)
  }
}
