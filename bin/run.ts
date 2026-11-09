import { type Command, CommanderError } from 'commander'

import { renderCommanderError } from '../src/lib/command-dx'
import { upgradeUnversionedState } from '../src/lib/legacy-state'
import { maybeRunStartupMaintenance } from '../src/lib/startup-maintenance'
import { configureInvocation } from '../src/lib/terminal/output'
import { buildProgram, normalizeRootVersionArgv } from '../src/program/index'
import { beginInvocation } from '../src/telemetry/recorder'
import { scanSessions } from '../src/telemetry/store'
import { maybeTriggerAnalysis } from '../src/telemetry/trigger'

// exitOverride must be applied to every subcommand: Commander copies the exit
// callback into subcommands at creation time, so setting it on the root only
// would let subcommand parse errors (e.g. missing required argument) call
// process.exit() directly — bypassing the renderCommanderError catch below
// while writeErr suppression still applies, i.e. a silent exit.
function overrideExits(command: Command): void {
  command.exitOverride()
  for (const child of command.commands) overrideExits(child)
}

/** The CLI's own child processes, which run outside the command program and its failure report. */
const INTERNAL_MODES = new Map<string, () => Promise<unknown>>([
  ['__studio-server', () => import('../studio/server/index')],
  ['__studio-extractor', () => import('../studio/server/introspect/extractor')],
  ['__studio-datasets', () => import('../studio/server/introspect/dataset-extractor')],
  ['__studio-bridge', () => import('../studio/server/agent/bridge/stdio')],
  ['__studio-acp-codex', () => import('@agentclientprotocol/codex-acp')],
  ['__studio-acp-claude', () => import('@agentclientprotocol/claude-agent-acp/dist/index.js')],
  [
    '__studio-agents-prefetch',
    async () =>
      (await import('../studio/server/agent/harness/acp/prefetch')).prefetchAgentBinaries(),
  ],
])

async function runInternalMode(): Promise<boolean> {
  const run = INTERNAL_MODES.get(process.argv[2] ?? '')
  if (run === undefined) return false
  process.argv.splice(2, 1)
  await run()
  return true
}

async function main(): Promise<void> {
  const argv = normalizeRootVersionArgv(process.argv)
  configureInvocation(argv)
  await upgradeUnversionedState()
  if (await maybeRunStartupMaintenance(argv)) return

  // One store scan feeds recording, retention, and analysis. Internal Studio
  // modes and startup maintenance intentionally bypass user-command telemetry.
  const sessions = scanSessions()
  const finalize =
    process.argv[2] === 'session' ? undefined : beginInvocation(process.argv, sessions)
  let errorName: string | undefined
  if (finalize) process.on('exit', (code) => finalize(code ?? 0, errorName))
  maybeTriggerAnalysis(process.argv, sessions)

  const program = await buildProgram()
  overrideExits(program)
  program.configureOutput({ writeErr: () => undefined })

  try {
    await program.parseAsync(argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) process.exit(0)
      errorName = error.code ?? 'CommanderError'
      process.stderr.write(renderCommanderError(program, error) + '\n')
      process.exit(error.exitCode ?? 1)
    }
    errorName = error instanceof Error ? error.name : 'UnknownError'
    throw error
  }
}

if (!(await runInternalMode())) {
  try {
    await main()
  } catch (error) {
    // Ctrl-C at an interactive (@inquirer/prompts) prompt exits quietly, the shell convention for
    // SIGINT. Every other failure gets the one report, so none reaches the runtime's own uncaught
    // error report, which prints source.
    if (error instanceof Error && error.name === 'ExitPromptError') process.exit(130)
    const { reportFailure } = await import('../src/connection/errors')
    await reportFailure(error, { debug: process.argv.includes('--debug') })
  }
}
