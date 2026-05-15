import type { CommandDefinition } from '../command'

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
    log.dim(`  Logs:    astrale server logs -f`)
    log.dim('  Stop:    astrale stop')
  } catch (e) {
    fatal(e)
  }
}

export default {
  name: 'restart',
  description: 'Restart the Astrale manager',
  afterHelpText: `
Behavior:
  Docker-mode by default. --host-mode stops then starts the host-mode
  manager; --foreground applies to host-mode only.

Examples:
  $ astrale restart
`,
  options: [
    { flags: '--foreground', description: 'Run in foreground (host-mode only)' },
    {
      flags: '--host-mode',
      description: 'Run the manager as a bun process on the host instead of docker',
    },
  ],
  action: async (opts) => {
    await restartCommand(opts as Parameters<typeof restartCommand>[0])
  },
} satisfies CommandDefinition
