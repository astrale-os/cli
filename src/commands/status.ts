import { readConfig } from '../lib/config'
import { composePs } from '../lib/docker'
import { log } from '../lib/log'
import { detectManagerState, probeHttp } from '../lib/manager-state'
import { type OutputOpts, isRawOutput, output } from '../lib/output'
import { COMPOSE_PATH } from '../lib/paths'

type ManagerMode = 'docker' | 'host' | 'none'

export async function statusCommand(opts?: OutputOpts): Promise<void> {
  const isRaw = isRawOutput(opts)
  const config = await readConfig()

  const managerUrl = `http://localhost:${config.managerPort}/mngt`
  const uiDevUrl = `http://localhost:${config.uiPort}`

  const [manager, uiDevUp, services] = await Promise.all([
    detectManagerState(config),
    probeHttp(uiDevUrl),
    composePs(COMPOSE_PATH),
  ])

  const managerService = services.find((s) => s.Service === 'manager')
  const falkorService = services.find((s) => s.Service === 'falkordb')
  const containerRunning = managerService?.State === 'running'
  const falkorUp = falkorService?.State === 'running'

  // Derive run mode:
  //   - `docker`: the `manager` service is up in compose.
  //   - `host`:   HTTP responds on manager port but compose service is not up.
  //   - `none`:   manager not reachable.
  const mode: ManagerMode = containerRunning ? 'docker' : manager.running ? 'host' : 'none'

  const uiUrl = uiDevUp
    ? uiDevUrl
    : manager.running
      ? `http://localhost:${config.managerPort}/`
      : null

  const data = {
    manager: {
      running: manager.running,
      mode,
      pid: manager.pid ?? null,
      port: config.managerPort,
      url: managerUrl,
      source: manager.source,
      containerState: managerService?.State ?? null,
      containerHealth: managerService?.Health ?? null,
    },
    falkor: {
      running: falkorUp,
      port: config.falkorPort,
    },
    ui: {
      running: uiUrl !== null,
      mode: uiDevUp ? 'dev' : 'bundled',
      url: uiUrl,
    },
    graphName: config.graphName,
  }

  if (isRaw || opts?.format) {
    output(data, opts ?? {})
    return
  }

  console.log('')
  log.info('Astrale Status\n')

  if (manager.running) {
    const pidPart = manager.pid !== undefined ? ` (PID ${manager.pid})` : ''
    const modeTag = mode === 'docker' ? ' [docker]' : mode === 'host' ? ' [host]' : ''
    log.success(`Manager:   running${pidPart}${modeTag} — ${managerUrl}`)
  } else {
    log.warn('Manager:   stopped')
  }

  if (falkorUp) {
    log.success(`FalkorDB:  running (port ${config.falkorPort})`)
  } else {
    log.warn('FalkorDB:  stopped')
  }

  if (uiUrl) {
    const modeTag = uiDevUp ? ' (dev)' : ''
    log.success(`UI:        ${uiUrl}${modeTag}`)
  } else {
    log.warn('UI:        not available (manager stopped)')
  }

  log.dim(`  Graph:    ${config.graphName}`)
  log.dim(`  Config:   ~/.astrale/config.json`)

  if (!manager.running) {
    console.log('')
    log.info('Run `astrale start` to start the manager')
  }
}
