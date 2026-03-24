import { log } from '../lib/log'
import { startCommand } from './start'
import { stopCommand } from './stop'

export async function restartCommand(opts: { foreground?: boolean }): Promise<void> {
  log.info('Stopping manager…')
  await stopCommand()

  // Brief pause to let the process fully exit
  await new Promise((r) => setTimeout(r, 500))

  log.info('Starting manager…')
  await startCommand(opts)
}
