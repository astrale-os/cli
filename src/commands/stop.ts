import { execSync } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'

import { readConfig } from '../lib/config'
import { log } from '../lib/log'
import { MANAGER_PID_PATH } from '../lib/paths'

function killPid(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ESRCH') return false
    throw e
  }
}

function findPidsByPort(port: number): number[] {
  try {
    const out = execSync(`lsof -i :${port} -t`, { encoding: 'utf-8' })
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((s) => parseInt(s, 10))
  } catch {
    return []
  }
}

export async function stopCommand(): Promise<void> {
  const config = await readConfig()
  let killed = false

  // 1. Try PID file
  try {
    const pid = parseInt(await readFile(MANAGER_PID_PATH, 'utf-8'), 10)
    if (killPid(pid)) {
      log.success(`Manager stopped (PID ${pid})`)
      killed = true
    } else {
      log.info(`Manager was not running (stale PID ${pid})`)
    }
  } catch {
    // No PID file
  }

  await unlink(MANAGER_PID_PATH).catch(() => {})

  // 2. Fallback: kill any process still holding the manager port
  const portPids = findPidsByPort(config.managerPort)
  for (const pid of portPids) {
    if (killPid(pid)) {
      log.success(`Killed lingering process on port ${config.managerPort} (PID ${pid})`)
      killed = true
    }
  }

  if (!killed) {
    log.info('No running manager found')
  }
}
