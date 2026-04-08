import { readConfig } from '../lib/config'
import { isFalkorRunning } from '../lib/docker'
import { log } from '../lib/log'
import { detectManagerState, probeHttp } from '../lib/manager-state'
import { isRawOutput, output } from '../lib/output'
import { COMPOSE_PATH } from '../lib/paths'

export async function statusCommand(opts?: { raw?: boolean; json?: boolean }): Promise<void> {
  const isRaw = isRawOutput(opts)
  const config = await readConfig()

  const uiUrl = `http://localhost:${config.uiPort}`
  const [manager, falkorUp, uiUp] = await Promise.all([
    detectManagerState(config),
    isFalkorRunning(COMPOSE_PATH),
    probeHttp(uiUrl),
  ])

  const managerUrl = `http://localhost:${config.managerPort}/mngt`

  if (isRaw) {
    output(
      {
        manager: {
          running: manager.running,
          pid: manager.pid ?? null,
          port: config.managerPort,
          url: managerUrl,
          source: manager.source,
        },
        falkor: {
          running: falkorUp,
          port: config.falkorPort,
        },
        ui: {
          running: uiUp,
          port: config.uiPort,
          url: uiUp ? uiUrl : null,
        },
        graphName: config.graphName,
      },
      opts ?? {},
    )
    return
  }

  console.log('')
  log.info('Astrale Status\n')

  if (manager.running) {
    const pidPart = manager.pid !== undefined ? ` (PID ${manager.pid})` : ''
    log.success(`Manager:   running${pidPart} — ${managerUrl}`)
  } else {
    log.warn('Manager:   stopped')
  }

  if (falkorUp) {
    log.success(`FalkorDB:  running (port ${config.falkorPort})`)
  } else {
    log.warn('FalkorDB:  stopped')
  }

  if (uiUp) {
    log.success(`UI:        ${uiUrl}`)
  } else {
    log.warn(`UI:        not responding (${uiUrl})`)
  }

  log.dim(`  Graph:    ${config.graphName}`)
  log.dim(`  Config:   ~/.astrale/config.json`)

  if (!manager.running) {
    console.log('')
    log.info('Run `astrale start` to start the manager')
  }
}
