import { readFile, unlink } from 'node:fs/promises'
import { MANAGER_PID_PATH } from '../lib/paths'
import { log } from '../lib/log'

export async function stopCommand(): Promise<void> {
  let pid: number
  try {
    pid = parseInt(await readFile(MANAGER_PID_PATH, 'utf-8'), 10)
  } catch {
    log.error('No running manager found (no PID file)')
    return
  }

  try {
    // Kill the process tree (manager + UI child)
    process.kill(pid, 'SIGTERM')
    log.success(`Manager stopped (PID ${pid})`)
  } catch (e: any) {
    if (e.code === 'ESRCH') {
      log.info(`Manager was not running (stale PID ${pid})`)
    } else {
      throw e
    }
  }

  await unlink(MANAGER_PID_PATH).catch(() => {})
}
