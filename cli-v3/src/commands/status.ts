import { readFile } from 'node:fs/promises'
import { readConfig } from '../lib/config'
import { isFalkorRunning } from '../lib/docker'
import { COMPOSE_PATH, MANAGER_PID_PATH } from '../lib/paths'
import { log } from '../lib/log'

async function isManagerRunning(): Promise<{ running: boolean; pid?: number }> {
  try {
    const pid = parseInt(await readFile(MANAGER_PID_PATH, 'utf-8'), 10)
    process.kill(pid, 0) // signal 0 = check alive
    return { running: true, pid }
  } catch {
    return { running: false }
  }
}

export async function statusCommand(): Promise<void> {
  const config = await readConfig()

  const [manager, falkorUp] = await Promise.all([
    isManagerRunning(),
    isFalkorRunning(COMPOSE_PATH),
  ])

  console.log('')
  log.info('Astrale Status\n')

  if (manager.running) {
    log.success(`Manager:   running (PID ${manager.pid}) — ws://localhost:${config.managerPort}/ws`)
  } else {
    log.warn('Manager:   stopped')
  }

  if (falkorUp) {
    log.success(`FalkorDB:  running (port ${config.falkorPort})`)
  } else {
    log.warn('FalkorDB:  stopped')
  }

  if (manager.running) {
    log.success(`UI:        http://localhost:${config.uiPort}`)
  }

  log.dim(`  Graph:    ${config.graphName}`)
  log.dim(`  Config:   ~/.astrale/config.json`)

  if (!manager.running) {
    console.log('')
    log.info('Run `astrale start` to start the manager')
  }
}
