import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { log } from '../../lib/log'
import { analyzeSession } from '../../telemetry/analyze'
import { listSessions } from '../../telemetry/store'
import { restampLock, releaseLock } from '../../telemetry/trigger'

export default {
  name: 'analyze',
  description: 'Analyze a recorded session for DX frictions (dry-run: writes report.md)',
  arguments: [{ name: 'id', description: 'Session id (default: most recent closed, unanalyzed)' }],
  options: [
    { flags: '--file', description: 'File cleared findings as issues on the admin tracker' },
    { flags: '--model <model>', description: 'Model for the analyzer pass' },
    { flags: '--force', description: 'Re-analyze even if already analyzed' },
    { flags: '--auto', description: 'Triggered mode: quiet, used by the opportunistic trigger' },
  ],
  action: async (
    id: string | undefined,
    opts: { file?: boolean; model?: string; force?: boolean; auto?: boolean },
  ) => {
    if (opts.auto) restampLock()
    try {
      let target = id
      if (!target) {
        const candidate = listSessions().find((s) => s.closed && (opts.force || !s.analyzed))
        if (!candidate) {
          if (!opts.auto) log.dim('Nothing to analyze — no closed, unanalyzed session.')
          return
        }
        target = candidate.id
      }
      if (!opts.auto) log.step(`analyzing session ${target} …`)
      const outcome = await analyzeSession(target, opts)
      if (opts.auto) return
      if (outcome.outcome === 'skipped-quiet') {
        log.dim(`quiet session (${outcome.note}) — nothing to analyze`)
      } else if (outcome.outcome === 'error') {
        log.error(`analyzer failed: ${outcome.note ?? 'unknown'}`)
      } else {
        log.success(`${outcome.outcome} (${outcome.note ?? ''})`)
        if (outcome.reportPath) console.log(chalk.dim(`  ${outcome.reportPath}`))
      }
    } finally {
      if (opts.auto) releaseLock()
    }
  },
} satisfies CommandDefinition
