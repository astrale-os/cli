import { execSync } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'

import { readConfig } from '../lib/config'
import { composeStop, isManagerRunning } from '../lib/docker'
import { log } from '../lib/log'
import { COMPOSE_PATH, MANAGER_PID_PATH } from '../lib/paths'

type StopOptions = {
  hostMode?: boolean
}

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

export async function stopCommand(opts: StopOptions = {}): Promise<void> {
  if (opts.hostMode) {
    await stopHostMode()
    return
  }

  // Default: docker-mode. If the compose service is running, stop it; if
  // not, fall through to a best-effort host-mode stop (covers the common
  // case of switching between modes without an explicit --host-mode flag).
  let stopped = false
  try {
    if (await isManagerRunning(COMPOSE_PATH)) {
      await composeStop(COMPOSE_PATH)
      log.success('Manager container stopped')
      stopped = true
    }
  } catch {
    // Docker not available / compose file missing — fall through.
  }

  // Host-mode salvage: a legacy bun process might still be holding the
  // port. Kill it silently if found.
  const hostKilled = await stopHostMode({ silent: true })
  if (hostKilled) stopped = true

  if (!stopped) {
    log.info('No running manager found (docker-mode or host-mode)')
  }
}

async function stopHostMode(opts: { silent?: boolean } = {}): Promise<boolean> {
  const config = await readConfig()
  let killed = false

  // 1. PID file
  try {
    const pid = parseInt(await readFile(MANAGER_PID_PATH, 'utf-8'), 10)
    if (killPid(pid)) {
      if (!opts.silent) log.success(`Manager stopped (PID ${pid})`)
      killed = true
    } else if (!opts.silent) {
      log.info(`Manager was not running (stale PID ${pid})`)
    }
  } catch {
    /* no PID file */
  }

  await unlink(MANAGER_PID_PATH).catch(() => {})

  // 2. Fallback: kill anything still holding the manager port.
  const portPids = findPidsByPort(config.managerPort)
  for (const pid of portPids) {
    if (killPid(pid)) {
      if (!opts.silent) {
        log.success(`Killed lingering process on port ${config.managerPort} (PID ${pid})`)
      }
      killed = true
    }
  }

  if (!killed && !opts.silent) {
    log.info('No host-mode manager found')
  }
  return killed
}
