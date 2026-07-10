import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'
import { listSessions } from '../../telemetry/store'

export default {
  name: 'list',
  description: 'List locally recorded work sessions and their analysis state',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    const sessions = listSessions()
    if (isMachine(opts)) {
      output(sessions, opts)
      return
    }
    if (sessions.length === 0) {
      log.dim('No sessions recorded yet. Run any astrale command in a workspace to start one.')
      return
    }
    for (const s of sessions) {
      const state = s.analyzed
        ? chalk.green(s.analyzed.outcome)
        : s.closed
          ? chalk.yellow('closed, unanalyzed')
          : chalk.cyan('open')
      const when = s.lastEventAt ? s.lastEventAt.toISOString().slice(0, 16) : 'no events'
      console.log(`${chalk.bold(s.id)}  ${state}`)
      console.log(chalk.dim(`  ${s.meta?.root ?? '(unknown root)'} — last activity ${when}`))
    }
  },
} satisfies CommandDefinition
