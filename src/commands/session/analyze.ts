import chalk from 'chalk'

import type { CommandDefinition } from '../../program/index'

import { log, withSpinner } from '../../lib/log'
import { isMachine } from '../../lib/output'
import { analyzeSession } from '../../telemetry/analyze'
import { sweepStore } from '../../telemetry/retention'
import { scanSessions } from '../../telemetry/store'
import { restampLock, releaseLock } from '../../telemetry/trigger'

export default {
  name: 'analyze',
  description: 'Analyze a recorded session for DX frictions (dry-run: writes report.md)',
  arguments: [
    // Optional: the action resolves the most recent closed, unanalyzed session
    // when no id is given, which is how a human is meant to invoke this. The
    // opportunistic trigger always passes an explicit id.
    {
      name: 'id',
      description: 'Session id (default: most recent closed, unanalyzed)',
      required: false,
    },
  ],
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
    let target = id
    try {
      if (!target) {
        const candidate = scanSessions().find((s) => s.closed && (opts.force || !s.analyzed))
        if (!candidate) {
          if (!opts.auto) log.dim('Nothing to analyze — no closed, unanalyzed session.')
          return
        }
        target = candidate.id
      }
      const session = target
      const outcome = await withSpinner(
        `Analyzing session ${session}`,
        !opts.auto && !isMachine(),
        () => analyzeSession(session, opts),
        {
          safetyMs: 10 * 60_000,
          longRunningText: `Still analyzing session ${session} — the model is taking a while.`,
        },
      )
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
      // The size bound is enforced here, not on the CLI's critical path:
      // measuring every file of every session is only affordable in this
      // process, and this is precisely where the store just grew. The session
      // just analyzed is protected — it is the freshest evidence on disk.
      try {
        const swept = sweepStore({ protect: new Set(target === undefined ? [] : [target]) })
        if (!opts.auto && swept.removed.length > 0) {
          log.dim(`retention: removed ${swept.removed.length} session(s)`)
        }
      } catch {
        /* retention must never fail the command that triggered it */
      }
    }
  },
} satisfies CommandDefinition
